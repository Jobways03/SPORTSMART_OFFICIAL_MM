import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FileMetadata,
  FileAttachment,
  FilePurpose,
  FileClassification,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { MediaStorageAdapter } from '../../../../integrations/media/media-storage.adapter';
import { R2Adapter } from '../../../../integrations/r2/adapters/r2.adapter';
import {
  hashBuffer,
  hashesEqual,
  HASH_ALGORITHM,
} from '../../../../core/file-integrity/file-hash.util';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

/** Phase 252 — who is allowed to view/act per caller. */
export interface FileCaller {
  actorId: string;
  actorType: string | null;
  isAdmin: boolean;
}

// Phase 252 (#3) — which polymorphic `resource` values a file of a given
// purpose may legitimately attach to. Blocks "attach a KYC PDF as a
// product_image" and rejects junk resource strings. Keys are normalised
// lower-case resource names; OTHER/admin uploads are unconstrained.
const PURPOSE_COMPATIBLE_RESOURCES: Partial<Record<FilePurpose, string[]>> = {
  KYC_DOCUMENT: ['seller_kyc', 'franchise_kyc', 'affiliate_kyc'],
  BANK_PROOF: ['seller_kyc', 'franchise_kyc', 'affiliate_kyc', 'payout_method'],
  QC_EVIDENCE: ['return', 'return_item', 'qc_evidence'],
  DISPUTE_EVIDENCE: ['dispute', 'dispute_evidence', 'return'],
  INVOICE: ['order', 'sub_order', 'invoice'],
  PRODUCT_IMAGE: ['product', 'product_variant', 'product_image'],
  PRODUCT_VIDEO: ['product', 'product_variant'],
  BANNER: ['banner', 'storefront_slot', 'collection'],
  AVATAR: ['seller', 'franchise', 'customer', 'affiliate', 'avatar'],
  TICKET_ATTACHMENT: ['ticket', 'ticket_message', 'support_ticket'],
  SHIPMENT_EVIDENCE: ['sub_order', 'shipment'],
};

const ALLOWED_ATTACH_RESOURCES = new Set<string>([
  ...new Set(Object.values(PURPOSE_COMPATIBLE_RESOURCES).flat()),
]);

/**
 * Per-purpose validation rules.
 *
 * `visibility` is TS-only — drives URL strategy at read time
 * (PUBLIC = stored providerUrl; PRIVATE = short-lived signed URL).
 * The persisted `classification` column maps purpose → an existing
 * FileClassification enum value used by other modules' moderation
 * queries.
 */
interface PurposeRule {
  maxBytes: number;
  allowedMime: RegExp;
  folder: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  classification: FileClassification;
}

const PURPOSE_RULES: Record<FilePurpose, PurposeRule> = {
  KYC_DOCUMENT: {
    maxBytes: 10 * 1024 * 1024,
    allowedMime: /^(application\/pdf|image\/(jpeg|png))$/,
    folder: 'kyc',
    visibility: 'PRIVATE',
    classification: 'KYC_DOCUMENT',
  },
  BANK_PROOF: {
    maxBytes: 10 * 1024 * 1024,
    allowedMime: /^(application\/pdf|image\/(jpeg|png))$/,
    folder: 'bank',
    visibility: 'PRIVATE',
    classification: 'KYC_DOCUMENT',
  },
  QC_EVIDENCE: {
    maxBytes: 25 * 1024 * 1024,
    allowedMime: /^image\/(jpeg|png|webp)$/,
    folder: 'qc',
    visibility: 'PRIVATE',
    classification: 'QC_EVIDENCE',
  },
  DISPUTE_EVIDENCE: {
    maxBytes: 25 * 1024 * 1024,
    allowedMime: /^(image\/(jpeg|png|webp)|application\/pdf|video\/mp4)$/,
    folder: 'disputes',
    visibility: 'PRIVATE',
    classification: 'RETURN_EVIDENCE',
  },
  INVOICE: {
    maxBytes: 5 * 1024 * 1024,
    allowedMime: /^application\/pdf$/,
    folder: 'invoices',
    visibility: 'PRIVATE',
    classification: 'PRODUCT_DOCUMENT',
  },
  PRODUCT_IMAGE: {
    maxBytes: 8 * 1024 * 1024,
    allowedMime: /^image\/(jpeg|png|webp)$/,
    folder: 'products',
    visibility: 'PUBLIC',
    classification: 'PRODUCT_IMAGE',
  },
  PRODUCT_VIDEO: {
    maxBytes: 50 * 1024 * 1024,
    allowedMime: /^video\/mp4$/,
    folder: 'products',
    visibility: 'PUBLIC',
    classification: 'PRODUCT_DOCUMENT',
  },
  BANNER: {
    maxBytes: 5 * 1024 * 1024,
    allowedMime: /^image\/(jpeg|png|webp)$/,
    folder: 'banners',
    visibility: 'PUBLIC',
    classification: 'PRODUCT_IMAGE',
  },
  AVATAR: {
    maxBytes: 2 * 1024 * 1024,
    allowedMime: /^image\/(jpeg|png|webp)$/,
    folder: 'avatars',
    visibility: 'PUBLIC',
    classification: 'SELLER_LOGO',
  },
  TICKET_ATTACHMENT: {
    maxBytes: 10 * 1024 * 1024,
    allowedMime: /^(image\/(jpeg|png|webp)|application\/pdf)$/,
    folder: 'tickets',
    visibility: 'PRIVATE',
    classification: 'PRODUCT_DOCUMENT',
  },
  SHIPMENT_EVIDENCE: {
    // Proof-of-dispatch photos. Image-only — admin needs to eyeball
    // the as-shipped condition; PDFs add no value. Cap is smaller
    // than QC evidence because pre-ship photos are contributed at
    // scale (one per shipment) so we keep them small to avoid blowing
    // out storage. Retention policy in PR 7.2 prunes them 60d after
    // delivery if no return is filed.
    maxBytes: 8 * 1024 * 1024,
    allowedMime: /^image\/(jpeg|png|webp)$/,
    folder: 'shipments',
    visibility: 'PRIVATE',
    classification: 'QC_EVIDENCE',
  },
  OTHER: {
    maxBytes: 10 * 1024 * 1024,
    // Phase 250 (#4) — was `/.*/` (accept-all), which made OTHER an
    // arbitrary-file (incl. .exe/.sh/.iso) upload primitive for any
    // authenticated caller. Restrict to safe document/image/text types.
    allowedMime: /^(application\/pdf|image\/(jpeg|png|webp)|text\/plain)$/,
    folder: 'other',
    visibility: 'PRIVATE',
    classification: 'PRODUCT_DOCUMENT',
  },
};

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaStorageAdapter,
    private readonly r2: R2Adapter,
    // Phase 250 — best-effort audit on upload/attach/delete. @Optional so
    // unit specs that construct the service directly keep working.
    @Optional() private readonly auditFacade?: AuditPublicFacade,
  ) {}

  /** Phase 250 — best-effort audit write; never throws into the caller. */
  private writeFileAudit(args: {
    action: string;
    actorId: string;
    actorType?: string | null;
    resourceId: string;
    metadata?: Record<string, unknown>;
  }): void {
    if (!this.auditFacade) return;
    void this.auditFacade
      .writeAuditLog({
        actorId: args.actorId,
        actorRole: args.actorType ?? undefined,
        action: args.action,
        module: 'files',
        resource: 'file',
        resourceId: args.resourceId,
        newValue: (args.metadata ?? null) as any,
      })
      .catch((e) =>
        this.logger.warn(`File audit (${args.action}) failed: ${(e as Error).message}`),
      );
  }

  // ── Direct upload (multipart) ────────────────────────────────────
  // Server receives the file, validates per-purpose, uploads to
  // media (configured today), persists READY metadata. This is
  // the "works now" path used by ticket / dispute / KYC UIs.

  async uploadDirect(args: {
    purpose: FilePurpose;
    file: Express.Multer.File;
    uploadedBy: string;
    uploadedByType?: string | null;
  }): Promise<FileMetadata> {
    const { fileMetadata } = await this.performUpload(args);
    return fileMetadata;
  }

  /**
   * Phase 249/250 — the central registration primitive. Does everything
   * uploadDirect does (per-purpose validation, magic-byte check, EXIF strip,
   * SHA-256 hash, a FileMetadata row → integrity-verifier + audit +
   * orphan-sweep coverage) AND returns the provider url / publicId /
   * dimensions, so the ~27 module-direct uploaders that today call
   * `media.upload()` raw can switch to this with a one-line change and
   * keep writing their own per-resource rows (ProductImage.url/publicId etc).
   */
  async uploadAndRegister(args: {
    purpose: FilePurpose;
    file: Express.Multer.File;
    uploadedBy: string;
    uploadedByType?: string | null;
  }): Promise<{
    fileId: string;
    url: string;
    publicId: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
  }> {
    const { fileMetadata, mediaResult } = await this.performUpload(args);
    return {
      fileId: fileMetadata.id,
      url: mediaResult.secureUrl,
      publicId: mediaResult.publicId,
      width: mediaResult.width,
      height: mediaResult.height,
      bytes: mediaResult.bytes,
      mimeType: fileMetadata.mimeType,
    };
  }

  private async performUpload(args: {
    purpose: FilePurpose;
    file: Express.Multer.File;
    uploadedBy: string;
    uploadedByType?: string | null;
  }): Promise<{ fileMetadata: FileMetadata; mediaResult: import('../../../../integrations/media/media-storage.adapter').MediaUploadResult }> {
    const rule = PURPOSE_RULES[args.purpose];
    if (!rule) throw new BadRequestAppException('Unknown upload purpose');
    this.validate(rule, args.file);
    // Phase 250 (#3) — magic-byte check: the declared mimetype is the
    // spoofable multipart header. Sniff the actual bytes and reject when the
    // content contradicts the rule (e.g. evil.exe declared as image/jpeg).
    this.assertContentMatches(rule, args.file.buffer, args.file.mimetype);

    // Phase 7 (PR 7.1) — hash the bytes BEFORE handing them to the
    // storage provider. The buffer is in memory anyway; the hash adds
    // ~10ms per MB to the upload latency, well below the network cost.
    const contentSha256 = hashBuffer(args.file.buffer);
    const hashedAt = new Date();

    const isImage = args.file.mimetype.startsWith('image/');
    const result = await this.media.upload(args.file.buffer, {
      folder: `sportsmart/${rule.folder}`,
      // Default to 'auto' so PDFs/videos work, not just images.
      resourceType: isImage ? 'image' : 'auto',
      // Phase 250 (#10) — strip EXIF/IPTC/XMP (incl. GPS + device serial)
      // from images. KYC/evidence/avatar photos otherwise leak the
      // uploader's physical location.
      ...(isImage ? { transformation: [{ flags: 'strip_profile' }] } : {}),
    });

    const created = await this.prisma.fileMetadata.create({
      data: {
        fileName: this.sanitizeFileName(args.file.originalname),
        mimeType: args.file.mimetype,
        sizeBytes: args.file.size,
        classification: rule.classification,
        purpose: args.purpose,
        status: 'READY',
        storageKey: result.publicId,
        // Persist the storage backend ('r2') so getSecureUrl / softDelete
        // route to the right provider.
        provider: this.media.providerTag,
        providerFileId: result.publicId,
        // PUBLIC files store the URL so we can hand it out without
        // a per-request signing call. PRIVATE files force getSecureUrl().
        providerUrl: rule.visibility === 'PUBLIC' ? result.secureUrl : null,
        uploadedBy: args.uploadedBy,
        uploadedByType: args.uploadedByType ?? null,
        contentSha256,
        hashAlgorithm: HASH_ALGORITHM,
        hashedAt,
        lastVerifiedAt: hashedAt,
      },
    });
    this.writeFileAudit({
      action: 'file.uploaded',
      actorId: args.uploadedBy,
      actorType: args.uploadedByType,
      resourceId: created.id,
      metadata: { purpose: args.purpose, mimeType: args.file.mimetype, sizeBytes: args.file.size },
    });
    return { fileMetadata: created, mediaResult: result };
  }

  /**
   * Phase 250 (#1) — register an asset that was uploaded to media
   * OUTSIDE this service (the ~27 module-direct uploaders). Purely additive:
   * the caller keeps its own upload + per-resource row; this adds the
   * FileMetadata row so the integrity-verifier, audit, and orphan sweep can
   * see the asset. Idempotent on storageKey (a retry returns the existing
   * row). Best-effort callers should `.catch()` — a failed registration must
   * not fail the upload that already succeeded. Pass `buffer` to hash inline;
   * otherwise the integrity cron backfills the hash.
   */
  async registerExternalAsset(args: {
    publicId: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    purpose: FilePurpose;
    uploadedBy: string;
    uploadedByType?: string | null;
    fileName?: string;
    buffer?: Buffer;
  }): Promise<string | null> {
    const rule = PURPOSE_RULES[args.purpose];
    const contentSha256 = args.buffer ? hashBuffer(args.buffer) : null;
    const now = new Date();
    try {
      const created = await this.prisma.fileMetadata.create({
        data: {
          fileName: this.sanitizeFileName(args.fileName ?? args.publicId),
          mimeType: args.mimeType,
          sizeBytes: args.sizeBytes,
          classification: rule?.classification ?? 'PRODUCT_IMAGE',
          purpose: args.purpose,
          status: 'READY',
          storageKey: args.publicId,
          provider: this.media.providerTag,
          providerFileId: args.publicId,
          providerUrl: (rule?.visibility ?? 'PUBLIC') === 'PUBLIC' ? args.url : null,
          uploadedBy: args.uploadedBy,
          uploadedByType: args.uploadedByType ?? null,
          ...(contentSha256
            ? { contentSha256, hashAlgorithm: HASH_ALGORITHM, hashedAt: now, lastVerifiedAt: now }
            : {}),
        },
      });
      this.writeFileAudit({
        action: 'file.registered',
        actorId: args.uploadedBy,
        actorType: args.uploadedByType,
        resourceId: created.id,
        metadata: { purpose: args.purpose, publicId: args.publicId },
      });
      return created.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.fileMetadata.findUnique({
          where: { storageKey: args.publicId },
          select: { id: true },
        });
        return existing?.id ?? null;
      }
      this.logger.warn(`registerExternalAsset failed for ${args.publicId}: ${(e as Error).message}`);
      return null;
    }
  }

  // ── Signed-URL upload-intent (S3 path) ──────────────────────────
  // Issues a pre-signed URL the client uses to upload directly. Server
  // creates a PENDING row that must be confirmed via confirmUpload().
  // Throws if S3 isn't configured — admin can fall back to uploadDirect.

  async createUploadIntent(args: {
    purpose: FilePurpose;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: string;
    uploadedByType?: string | null;
  }): Promise<{
    fileId: string;
    uploadUrl: string;
    publicUrl: string;
    expiresAt: Date;
  }> {
    const rule = PURPOSE_RULES[args.purpose];
    this.validateMeta(rule, args.fileName, args.mimeType, args.sizeBytes);

    const presigned = await this.r2.createUploadUrl({
      folder: `sportsmart/${rule.folder}`,
      filename: args.fileName,
      contentType: args.mimeType,
      expiresInSeconds: 600,
    });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const file = await this.prisma.fileMetadata.create({
      data: {
        fileName: args.fileName,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        classification: rule.classification,
        purpose: args.purpose,
        status: 'PENDING',
        storageKey: presigned.key,
        provider: 'r2',
        providerFileId: presigned.key,
        providerUrl: rule.visibility === 'PUBLIC' ? presigned.publicUrl : null,
        uploadedBy: args.uploadedBy,
        uploadedByType: args.uploadedByType ?? null,
        expiresAt,
      },
    });

    return {
      fileId: file.id,
      uploadUrl: presigned.uploadUrl,
      publicUrl: presigned.publicUrl,
      expiresAt,
    };
  }

  async confirmUpload(args: {
    fileId: string;
    uploadedBy: string;
  }): Promise<FileMetadata> {
    const file = await this.prisma.fileMetadata.findUnique({
      where: { id: args.fileId },
    });
    if (!file) throw new NotFoundAppException('File not found');
    if (file.uploadedBy !== args.uploadedBy) {
      throw new ForbiddenAppException('Not allowed to confirm this file');
    }
    if (file.status === 'READY') return file;
    if (file.status === 'DELETED') {
      throw new BadRequestAppException('File has been deleted');
    }
    if (file.expiresAt && file.expiresAt < new Date()) {
      throw new BadRequestAppException('Upload window expired — request a new intent');
    }
    // Phase 7 (PR 7.1) — S3 confirm path doesn't hash inline. The
    // bytes already left our process via the pre-signed URL; re-fetching
    // them just to hash would double the upload latency. The integrity
    // verifier cron (PR 7.5) picks up READY files with hashedAt=NULL and
    // backfills the hash on its next pass. The gap is bounded by the
    // cron's cadence (1h default).
    return this.prisma.fileMetadata.update({
      where: { id: file.id },
      data: { status: 'READY' },
    });
  }

  // ── Reads ────────────────────────────────────────────────────────

  async findById(id: string): Promise<FileMetadata> {
    const file = await this.prisma.fileMetadata.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!file || file.deletedAt) {
      throw new NotFoundAppException('File not found');
    }
    return file;
  }

  /**
   * Phase 252 (#14) — owner-or-admin gate for a PRIVATE file. PUBLIC files
   * (product images, banners, avatars) are world-readable by intent and
   * pass freely. For PRIVATE files (KYC, bank proof, dispute/return/QC
   * evidence, invoices, tickets) the caller must be the uploader or an
   * admin — otherwise a leaked/guessed fileId is an IDOR into anyone's
   * private documents. (A richer "can view the attached resource" check —
   * e.g. the seller party to a dispute — is the surfaced follow-up; this
   * owner-or-admin gate closes the cross-user PII leak.)
   */
  private assertCanView(file: FileMetadata, caller: FileCaller): void {
    const rule = PURPOSE_RULES[file.purpose];
    const isPublic = rule?.visibility === 'PUBLIC';
    if (isPublic) return;
    if (caller.isAdmin) return;
    if (file.uploadedBy && file.uploadedBy === caller.actorId) return;
    throw new ForbiddenAppException('Not allowed to access this file');
  }

  /** findById + owner/admin ACL — used by the metadata + secure-url reads. */
  async findByIdForCaller(id: string, caller: FileCaller): Promise<FileMetadata> {
    const file = await this.findById(id);
    this.assertCanView(file, caller);
    return file;
  }

  /** Short-lived signed URL for download. PUBLIC files redirect to providerUrl. */
  async getSecureUrl(id: string, caller: FileCaller): Promise<string> {
    const file = await this.findById(id);
    this.assertCanView(file, caller);
    // If we stored a providerUrl up front, the file is PUBLIC by intent.
    // PRIVATE files have providerUrl=null so we always go to the signing path.
    if (file.providerUrl) {
      return file.providerUrl;
    }
    if (file.provider === 'r2') {
      return this.r2.createAccessUrl({ key: file.storageKey, expiresInSeconds: 300 });
    }
    if (file.provider === 'cloudinary') {
      // PRIVATE media files have providerUrl=null by design (we
      // don't surface the URL except via this authed endpoint). Derive
      // the canonical delivery URL from the stored publicId so the
      // caller — admin returns page, seller orders page — can render
      // thumbnails. media `type: 'upload'` URLs are publicly
      // resolvable once known; the privacy contract is "you must
      // authenticate to learn the URL," not authenticated delivery.
      const publicId = file.providerFileId ?? file.storageKey;
      if (!publicId) return '';
      const resourceType = file.mimeType.startsWith('video/')
        ? 'video'
        : file.mimeType.startsWith('image/')
          ? 'image'
          : 'raw';
      return this.media.urlFor(publicId, { resourceType });
    }
    throw new BadRequestAppException(`Unsupported provider: ${file.provider}`);
  }

  // ── Attachments ──────────────────────────────────────────────────

  async attach(args: {
    fileId: string;
    resource: string;
    resourceId: string;
    caption?: string;
    attachedBy: string;
    attachedByIsAdmin?: boolean;
  }): Promise<FileAttachment> {
    const file = await this.findById(args.fileId);
    if (file.status !== 'READY') {
      throw new BadRequestAppException('File is not READY — confirm upload first');
    }
    const resource = (args.resource ?? '').trim().toLowerCase();

    // Phase 252 (#2) — file-ownership: only the uploader (or an admin) may
    // attach a file. Stops a caller who learns another user's fileId from
    // re-using their KYC/evidence as their own product image.
    if (!args.attachedByIsAdmin && file.uploadedBy !== args.attachedBy) {
      throw new ForbiddenAppException('Not allowed to attach this file');
    }
    // Phase 252 (#4) — resource must be a known polymorphic target.
    if (!ALLOWED_ATTACH_RESOURCES.has(resource)) {
      throw new BadRequestAppException(`Unsupported attach resource "${args.resource}"`);
    }
    // Phase 252 (#3) — purpose ↔ resource compatibility (a KYC PDF cannot
    // become a product_image; an INVOICE cannot become dispute evidence).
    const compatible = PURPOSE_COMPATIBLE_RESOURCES[file.purpose];
    if (compatible && !compatible.includes(resource)) {
      throw new BadRequestAppException(
        `A ${file.purpose} file cannot be attached as "${resource}"`,
      );
    }
    // Phase 252 (#12) — idempotent: the unique (fileId, resource, resourceId)
    // index turns a double-attach into a return-existing instead of a dup row.
    try {
      const row = await this.prisma.fileAttachment.create({
        data: {
          fileId: args.fileId,
          resource,
          resourceId: args.resourceId,
          caption: args.caption ?? null,
          attachedBy: args.attachedBy,
        },
      });
      this.writeFileAudit({
        action: 'file.attached',
        actorId: args.attachedBy,
        resourceId: args.fileId,
        metadata: { resource, resourceId: args.resourceId, purpose: file.purpose },
      });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.fileAttachment.findFirst({
          where: { fileId: args.fileId, resource, resourceId: args.resourceId },
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async listByResource(resource: string, resourceId: string) {
    return this.prisma.fileAttachment.findMany({
      where: { resource, resourceId },
      include: { file: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Sync helper to derive a viewable URL for an attached file. Mirrors
   * the legacy-provider branch of getSecureUrl() but is sync (no DB lookup —
   * caller already has the file row) and so safe to call inside a list
   * enrichment loop. Used by controllers that surface file galleries
   * (shipment evidence, return evidence, ticket attachments) where the
   * frontend needs an `<img src>` URL for thumbnails.
   */
  viewUrlFor(file: {
    providerUrl: string | null;
    provider: string;
    providerFileId: string | null;
    storageKey: string;
    mimeType: string;
  }): string {
    if (file.providerUrl) return file.providerUrl;
    if (file.provider === 'cloudinary') {
      const publicId = file.providerFileId ?? file.storageKey;
      if (!publicId) return '';
      const resourceType = file.mimeType.startsWith('video/')
        ? 'video'
        : file.mimeType.startsWith('image/')
          ? 'image'
          : 'raw';
      return this.media.urlFor(publicId, { resourceType });
    }
    return '';
  }

  /**
   * Async sibling of viewUrlFor that can presign **R2** objects. PRIVATE files
   * on R2 (e.g. SHIPMENT_EVIDENCE) have `providerUrl = null` and are reachable
   * only via a presigned GET URL — which the AWS presigner produces
   * asynchronously, so the sync `viewUrlFor` cannot build it and returns ''
   * for `provider === 'r2'`. That left every R2-backed evidence gallery
   * (seller / admin / franchise / customer POD) rendering filename text with no
   * thumbnail. Use this in list-enrichment loops via `Promise.all`. Mirrors the
   * provider branches of `getSecureUrl`, but takes the already-loaded file row
   * (no id lookup, no caller assert — ownership is enforced by the caller).
   */
  async viewUrlForAsync(file: {
    providerUrl: string | null;
    provider: string;
    providerFileId: string | null;
    storageKey: string;
    mimeType: string;
  }): Promise<string> {
    if (file.providerUrl) return file.providerUrl;
    if (file.provider === 'r2') {
      try {
        // 1h window — long enough to view a gallery without expiring mid-page,
        // and the list endpoint re-mints fresh URLs on every load.
        return await this.r2.createAccessUrl({
          key: file.storageKey,
          expiresInSeconds: 3600,
        });
      } catch {
        return '';
      }
    }
    return this.viewUrlFor(file);
  }

  // ── Admin moderation surface (Sprint 2 Story 1.2) ───────────────
  // Distinct from listByResource: admins moderate across the whole
  // platform, not just one resource. Encapsulated here so the
  // controller doesn't reach into PrismaService directly — the prior
  // `(service as any).prisma.fileMetadata.findMany` antipattern.

  /**
   * Paginated admin moderation list. Filters by purpose, uploader,
   * date range, and optionally includes soft-deleted rows (default
   * excludes them — admins explicitly request deleted-only via the
   * `includeDeleted` flag for retention/legal review).
   */
  async listForAdmin(filters: {
    purpose?: FilePurpose;
    uploadedBy?: string;
    fromDate?: Date;
    toDate?: Date;
    includeDeleted?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(Math.max(1, filters.limit ?? 50), 200);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      ...(filters.purpose ? { purpose: filters.purpose } : {}),
      ...(filters.uploadedBy ? { uploadedBy: filters.uploadedBy } : {}),
      ...(filters.includeDeleted ? {} : { deletedAt: null }),
    };
    if (filters.fromDate || filters.toDate) {
      where.createdAt = {
        ...(filters.fromDate ? { gte: filters.fromDate } : {}),
        ...(filters.toDate ? { lte: filters.toDate } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.fileMetadata.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.fileMetadata.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Admin file detail — same as findById but includes the attachment
   * graph so the moderator can see every place the file is in use
   * before deciding to delete or escalate.
   */
  async findByIdForAdmin(id: string): Promise<FileMetadata & { attachments: FileAttachment[] }> {
    const file = await this.prisma.fileMetadata.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!file) {
      throw new NotFoundAppException(`File ${id} not found`);
    }
    return file as FileMetadata & { attachments: FileAttachment[] };
  }

  // ── Soft delete ──────────────────────────────────────────────────

  async softDelete(id: string, requesterId: string, requesterIsAdmin: boolean) {
    const file = await this.findById(id);
    if (!requesterIsAdmin && file.uploadedBy !== requesterId) {
      throw new ForbiddenAppException('Not allowed to delete this file');
    }
    // Phase 253 (#2) — actually remove the bytes from the storage provider.
    // Previously this only flipped the DB row to DELETED, so a "deleted"
    // KYC/evidence asset stayed publicly resolvable at its media URL
    // forever (DPDP §6 right-to-erasure breach). Best-effort: if the
    // provider delete fails we still soft-delete the row (the orphan-sweep
    // can retry), but we surface the failure in the audit metadata.
    const providerKey = file.providerFileId ?? file.storageKey;
    let providerDeleted: { ok: boolean; reason?: string } = { ok: false };
    if (file.provider === 'cloudinary' && providerKey) {
      providerDeleted = await this.media.deleteAsset(providerKey, {
        resourceType: file.mimeType.startsWith('video/')
          ? 'video'
          : file.mimeType.startsWith('image/')
            ? 'image'
            : 'raw',
      });
    } else if (file.provider === 'r2' && file.storageKey) {
      // R2 objects are keyed by storageKey (the bucket key).
      try {
        await this.r2.deleteFile(file.storageKey);
        providerDeleted = { ok: true };
      } catch (e) {
        providerDeleted = { ok: false, reason: (e as Error).message };
      }
    }
    const updated = await this.prisma.fileMetadata.update({
      where: { id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    // Phase 252 (#13) — drop attachments so listByResource doesn't keep
    // surfacing a now-deleted file as a broken thumbnail.
    await this.prisma.fileAttachment.deleteMany({ where: { fileId: id } });
    this.writeFileAudit({
      action: 'file.deleted',
      actorId: requesterId,
      resourceId: id,
      metadata: {
        purpose: file.purpose,
        adminOverride: requesterIsAdmin && file.uploadedBy !== requesterId,
        providerDeleted: providerDeleted.ok,
        providerDeleteError: providerDeleted.reason ?? null,
      },
    });
    return updated;
  }

  // ── Validation helpers ──────────────────────────────────────────

  private validate(rule: PurposeRule, file: Express.Multer.File) {
    this.validateMeta(rule, file.originalname, file.mimetype, file.size);
  }

  private validateMeta(
    rule: PurposeRule,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
  ) {
    if (!fileName?.trim()) throw new BadRequestAppException('fileName is required');
    if (sizeBytes <= 0) throw new BadRequestAppException('sizeBytes must be > 0');
    if (sizeBytes > rule.maxBytes) {
      throw new BadRequestAppException(
        `File too large — max ${(rule.maxBytes / 1024 / 1024).toFixed(0)} MB for this kind`,
      );
    }
    if (!rule.allowedMime.test(mimeType)) {
      throw new BadRequestAppException(
        `Unsupported file type "${mimeType}" for this kind`,
      );
    }
  }

  /**
   * Phase 250 (#3) — content-vs-declared validation via magic bytes. The
   * multipart Content-Type is client-controlled and trivially spoofable, so
   * we sniff the actual leading bytes:
   *  - if we positively detect a type, it must be allowed by the rule
   *    (a real PNG renamed/declared as a PDF for an INVOICE is rejected;
   *     an .exe sniffs to no known media signature → rejected);
   *  - if the signature is unknown, only text/plain (which has no magic
   *    bytes and is allowed only by OTHER) may pass.
   */
  private assertContentMatches(
    rule: PurposeRule,
    buffer: Buffer,
    declaredMime: string,
  ): void {
    const detected = this.sniffMime(buffer);
    if (detected) {
      if (!rule.allowedMime.test(detected)) {
        throw new BadRequestAppException(
          `File content (detected ${detected}) does not match an allowed type for this kind`,
        );
      }
      return;
    }
    if (declaredMime === 'text/plain' && rule.allowedMime.test('text/plain')) {
      return;
    }
    throw new BadRequestAppException(
      `Could not verify that the file content matches "${declaredMime}"`,
    );
  }

  /** Detect a canonical mime from leading magic bytes; null if unknown. */
  private sniffMime(buf: Buffer): string | null {
    if (!buf || buf.length < 4) return null;
    const b = buf;
    // JPEG: FF D8 FF
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    // GIF: 47 49 46 38
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    // PDF: 25 50 44 46 (%PDF)
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
    if (b.length >= 12) {
      // WEBP: RIFF....WEBP
      if (
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
      ) {
        return 'image/webp';
      }
      // MP4 / ISO-BMFF: bytes 4-7 = 'ftyp'
      if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
        return 'video/mp4';
      }
    }
    return null;
  }

  /**
   * Phase 250 — strip path separators / control chars from the client-
   * supplied filename so it can't become a traversal or header-injection
   * vector in any downstream consumer (Content-Disposition, exports).
   */
  private sanitizeFileName(name: string | undefined): string {
    const base = (name ?? 'file').split(/[\\/]/).pop() ?? 'file';
    const cleaned = base
      .replace(/[^A-Za-z0-9._\- ]/g, '_')
      .replace(/\.{2,}/g, '_')
      .trim()
      .slice(0, 200);
    return cleaned || 'file';
  }
}
