import { Injectable, Logger } from '@nestjs/common';
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
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
import { S3Adapter } from '../../../../integrations/s3/adapters/s3.adapter';
import {
  hashBuffer,
  hashesEqual,
  HASH_ALGORITHM,
} from '../../../../core/file-integrity/file-hash.util';

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
    allowedMime: /.*/,
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
    private readonly cloudinary: CloudinaryAdapter,
    private readonly s3: S3Adapter,
  ) {}

  // ── Direct upload (multipart) ────────────────────────────────────
  // Server receives the file, validates per-purpose, uploads to
  // Cloudinary (configured today), persists READY metadata. This is
  // the "works now" path used by ticket / dispute / KYC UIs.

  async uploadDirect(args: {
    purpose: FilePurpose;
    file: Express.Multer.File;
    uploadedBy: string;
  }): Promise<FileMetadata> {
    const rule = PURPOSE_RULES[args.purpose];
    this.validate(rule, args.file);

    // Phase 7 (PR 7.1) — hash the bytes BEFORE handing them to the
    // storage provider. The buffer is in memory anyway; the hash adds
    // ~10ms per MB to the upload latency, well below the network cost.
    const contentSha256 = hashBuffer(args.file.buffer);
    const hashedAt = new Date();

    const result = await this.cloudinary.upload(args.file.buffer, {
      folder: `sportsmart/${rule.folder}`,
      // Default to 'auto' so PDFs/videos work, not just images.
      resourceType: args.file.mimetype.startsWith('image/') ? 'image' : 'auto',
    });

    return this.prisma.fileMetadata.create({
      data: {
        fileName: args.file.originalname,
        mimeType: args.file.mimetype,
        sizeBytes: args.file.size,
        classification: rule.classification,
        purpose: args.purpose,
        status: 'READY',
        storageKey: result.publicId,
        provider: 'cloudinary',
        providerFileId: result.publicId,
        // PUBLIC files store the URL so we can hand it out without
        // a per-request signing call. PRIVATE files force getSecureUrl().
        providerUrl: rule.visibility === 'PUBLIC' ? result.secureUrl : null,
        uploadedBy: args.uploadedBy,
        contentSha256,
        hashAlgorithm: HASH_ALGORITHM,
        hashedAt,
        lastVerifiedAt: hashedAt,
      },
    });
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
  }): Promise<{
    fileId: string;
    uploadUrl: string;
    publicUrl: string;
    expiresAt: Date;
  }> {
    const rule = PURPOSE_RULES[args.purpose];
    this.validateMeta(rule, args.fileName, args.mimeType, args.sizeBytes);

    const presigned = this.s3.createUploadUrl({
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
        provider: 's3',
        providerFileId: presigned.key,
        providerUrl: rule.visibility === 'PUBLIC' ? presigned.publicUrl : null,
        uploadedBy: args.uploadedBy,
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

  /** Short-lived signed URL for download. PUBLIC files redirect to providerUrl. */
  async getSecureUrl(id: string): Promise<string> {
    const file = await this.findById(id);
    // If we stored a providerUrl up front, the file is PUBLIC by intent.
    // PRIVATE files have providerUrl=null so we always go to the signing path.
    if (file.providerUrl) {
      return file.providerUrl;
    }
    if (file.provider === 's3') {
      return this.s3.createAccessUrl({ key: file.storageKey, expiresInSeconds: 300 });
    }
    if (file.provider === 'cloudinary') {
      // PRIVATE Cloudinary files have providerUrl=null by design (we
      // don't surface the URL except via this authed endpoint). Derive
      // the canonical delivery URL from the stored publicId so the
      // caller — admin returns page, seller orders page — can render
      // thumbnails. Cloudinary `type: 'upload'` URLs are publicly
      // resolvable once known; the privacy contract is "you must
      // authenticate to learn the URL," not authenticated delivery.
      const publicId = file.providerFileId ?? file.storageKey;
      if (!publicId) return '';
      const resourceType = file.mimeType.startsWith('video/')
        ? 'video'
        : file.mimeType.startsWith('image/')
          ? 'image'
          : 'raw';
      return this.cloudinary.urlFor(publicId, { resourceType });
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
  }): Promise<FileAttachment> {
    const file = await this.findById(args.fileId);
    if (file.status !== 'READY') {
      throw new BadRequestAppException('File is not READY — confirm upload first');
    }
    return this.prisma.fileAttachment.create({
      data: {
        fileId: args.fileId,
        resource: args.resource,
        resourceId: args.resourceId,
        caption: args.caption ?? null,
        attachedBy: args.attachedBy,
      },
    });
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
   * the cloudinary branch of getSecureUrl() but is sync (no DB lookup —
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
      return this.cloudinary.urlFor(publicId, { resourceType });
    }
    return '';
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
    return this.prisma.fileMetadata.update({
      where: { id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
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
}
