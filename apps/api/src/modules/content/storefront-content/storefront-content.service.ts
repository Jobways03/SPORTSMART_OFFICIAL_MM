import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../bootstrap/cache/redis.service';
import { CloudinaryAdapter } from '../../../integrations/cloudinary/cloudinary.adapter';
import { ContentAuditService } from './content-audit.service';

/**
 * Phase 47 (2026-05-21) — public-read cache.
 *
 * The storefront homepage hits `listActiveAsMap()` on every server-
 * render (no ISR yet on this endpoint). Caching it in Redis for 30s
 * with explicit invalidation on every admin write means:
 *   - Read-path: O(1) Redis hit when the cache is warm.
 *   - Write-path: the admin's update is visible on the next read
 *     because we DEL the key inside the write.
 *   - Stale window: at most 30s if Redis is down + an active write
 *     happens in the meantime — acceptable for marketing copy.
 */
export const STOREFRONT_CONTENT_ACTIVE_MAP_KEY =
  'storefront-content:active-map:v1';
export const STOREFRONT_CONTENT_ACTIVE_MAP_TTL_SECONDS = 30;

/**
 * Phase 47 (2026-05-21) — storefront content blocks. Each row is one
 * homepage slot (hero-slide-1, sport-running, deal-goggles, …). The
 * storefront fetches the active map once per ISR window and threads
 * the values into MediaTile.
 *
 * Phase 47 changes:
 *   - imagePublicId persisted alongside imageUrl so Cloudinary
 *     orphans are cleaned up on replace / reset / delete.
 *   - listActiveAsMap filters by [startAt, endAt) schedule window
 *     so admin can pre-load campaign banners.
 *   - Soft-delete on resetSlot. The row is marked deletedAt; admin
 *     can restore from the audit log if it was a misclick.
 *   - Every mutation writes a ContentAuditLog row.
 */

export interface StorefrontContentBlockDto {
  slot: string;
  imageUrl: string | null;
  imageAlt: string | null;
  eyebrow: string | null;
  headline: string | null;
  subhead: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  price: string | null;
  priceCaption: string | null;
  active: boolean;
  startAt: string | null;
  endAt: string | null;
  updatedAt: Date;
}

export interface UpsertStorefrontContentInput {
  imageUrl?: string | null;
  imageAlt?: string | null;
  eyebrow?: string | null;
  headline?: string | null;
  subhead?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  price?: string | null;
  priceCaption?: string | null;
  active?: boolean;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
}

@Injectable()
export class StorefrontContentService {
  private readonly logger = new Logger(StorefrontContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryAdapter,
    private readonly audit: ContentAuditService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Best-effort cache invalidation. A Redis outage should NOT break
   * the write path — we log and continue. The TTL will eventually
   * heal the cache to truth.
   */
  async invalidateActiveMapCache(): Promise<void> {
    try {
      await this.redis.del(STOREFRONT_CONTENT_ACTIVE_MAP_KEY);
    } catch (err) {
      this.logger.warn(
        `Storefront content cache invalidation failed: ${(err as Error).message}`,
      );
    }
  }

  async listAll(): Promise<StorefrontContentBlockDto[]> {
    const rows = await this.prisma.storefrontContentBlock.findMany({
      where: { deletedAt: null },
      orderBy: { slot: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Public: ACTIVE rows whose schedule window includes "now". Used by
   * the storefront home; absent rows trigger the curated fallback.
   *
   * Phase 47 changes:
   *   - Schedule-window filter (a stale `active=true` row past its
   *     endAt no longer leaks to the storefront).
   *   - Redis cache (30s TTL, invalidated on every admin write). The
   *     `at` override (used by unit tests) bypasses the cache so
   *     window-boundary tests stay deterministic.
   */
  async listActiveAsMap(
    at?: Date,
  ): Promise<Record<string, StorefrontContentBlockDto>> {
    if (at !== undefined) {
      return this.queryActiveMap(at);
    }
    return this.redis.getOrSet(
      STOREFRONT_CONTENT_ACTIVE_MAP_KEY,
      STOREFRONT_CONTENT_ACTIVE_MAP_TTL_SECONDS,
      () => this.queryActiveMap(new Date()),
    );
  }

  private async queryActiveMap(
    at: Date,
  ): Promise<Record<string, StorefrontContentBlockDto>> {
    const rows = await this.prisma.storefrontContentBlock.findMany({
      where: {
        active: true,
        deletedAt: null,
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: at } }] },
          { OR: [{ endAt: null }, { endAt: { gt: at } }] },
        ],
      },
    });
    const out: Record<string, StorefrontContentBlockDto> = {};
    for (const r of rows) out[r.slot] = this.toDto(r);
    return out;
  }

  async findBySlot(slot: string): Promise<StorefrontContentBlockDto | null> {
    const row = await this.prisma.storefrontContentBlock.findUnique({
      where: { slot },
    });
    if (!row || row.deletedAt) return null;
    return this.toDto(row);
  }

  async upsert(
    slot: string,
    input: UpsertStorefrontContentInput,
    updatedById?: string,
  ): Promise<StorefrontContentBlockDto> {
    const before = await this.prisma.storefrontContentBlock.findUnique({
      where: { slot },
    });

    const row = await this.prisma.storefrontContentBlock.upsert({
      where: { slot },
      create: {
        slot,
        imageUrl: input.imageUrl ?? null,
        imageAlt: input.imageAlt ?? null,
        eyebrow: input.eyebrow ?? null,
        headline: input.headline ?? null,
        subhead: input.subhead ?? null,
        ctaLabel: input.ctaLabel ?? null,
        ctaHref: input.ctaHref ?? null,
        price: input.price ?? null,
        priceCaption: input.priceCaption ?? null,
        active: input.active ?? true,
        startAt: input.startAt ? new Date(input.startAt) : null,
        endAt: input.endAt ? new Date(input.endAt) : null,
        updatedById: updatedById ?? null,
      },
      update: {
        // `undefined` leaves a field untouched; explicit null clears it.
        imageUrl: input.imageUrl === undefined ? undefined : input.imageUrl,
        imageAlt: input.imageAlt === undefined ? undefined : input.imageAlt,
        eyebrow: input.eyebrow === undefined ? undefined : input.eyebrow,
        headline: input.headline === undefined ? undefined : input.headline,
        subhead: input.subhead === undefined ? undefined : input.subhead,
        ctaLabel: input.ctaLabel === undefined ? undefined : input.ctaLabel,
        ctaHref: input.ctaHref === undefined ? undefined : input.ctaHref,
        price: input.price === undefined ? undefined : input.price,
        priceCaption: input.priceCaption === undefined ? undefined : input.priceCaption,
        active: input.active === undefined ? undefined : input.active,
        startAt:
          input.startAt === undefined
            ? undefined
            : input.startAt
              ? new Date(input.startAt)
              : null,
        endAt:
          input.endAt === undefined
            ? undefined
            : input.endAt
              ? new Date(input.endAt)
              : null,
        // Phase 47 — clearing deletedAt undoes a soft-delete by
        // re-upserting (admins can recover via the audit log).
        deletedAt: null,
        updatedById: updatedById ?? null,
      },
    });

    await this.audit.record({
      resourceType: 'CONTENT_BLOCK',
      resourceId: slot,
      action: before ? 'UPDATE' : 'CREATE',
      prevState: before ? (this.toAuditSnapshot(before) as any) : null,
      newState: this.toAuditSnapshot(row) as any,
      actorId: updatedById,
    });
    await this.invalidateActiveMapCache();
    return this.toDto(row);
  }

  /**
   * Phase 47 — reset = soft-delete + Cloudinary asset cleanup.
   * Pre-Phase-47 the row was hard-deleted and the Cloudinary asset
   * orphaned. Now the row stays (deletedAt stamped) so the audit log
   * can show the rollback target; Cloudinary delete is fire-and-
   * forget post-flush.
   */
  async resetSlot(slot: string, actorId?: string): Promise<void> {
    const existing = await this.prisma.storefrontContentBlock.findUnique({
      where: { slot },
    });
    if (!existing || existing.deletedAt) return;

    await this.prisma.storefrontContentBlock.update({
      where: { slot },
      data: { deletedAt: new Date(), active: false, updatedById: actorId ?? null },
    });

    if (existing.imagePublicId) {
      this.cloudinary
        .delete(existing.imagePublicId)
        .catch((err) =>
          this.logger.warn(
            `Cloudinary delete failed for ${existing.imagePublicId}: ${(err as Error).message}`,
          ),
        );
    }

    await this.audit.record({
      resourceType: 'CONTENT_BLOCK',
      resourceId: slot,
      action: 'RESET',
      prevState: this.toAuditSnapshot(existing) as any,
      newState: null,
      actorId,
    });
    await this.invalidateActiveMapCache();
  }

  /**
   * Phase 47 — upload + persist publicId. On replace (existing
   * publicId differs from new), the prior Cloudinary asset is
   * deleted fire-and-forget.
   */
  async uploadImage(
    slot: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    updatedById?: string,
  ): Promise<StorefrontContentBlockDto> {
    const before = await this.prisma.storefrontContentBlock.findUnique({
      where: { slot },
    });

    const result = await this.cloudinary.upload(file.buffer, {
      folder: `storefront-content/${slot}`,
      resourceType: 'image',
      // Phase 47 — cap dimensions so a 5000×3000 upload doesn't ship to
      // every storefront client. Cloudinary's `limit` only scales down.
      transformation: [{ width: 1600, height: 900, crop: 'limit' }],
    });
    this.logger.log(
      `Storefront content image uploaded for slot=${slot} publicId=${result.publicId}`,
    );

    let row;
    try {
      row = await this.prisma.storefrontContentBlock.upsert({
        where: { slot },
        create: {
          slot,
          imageUrl: result.secureUrl,
          imagePublicId: result.publicId,
          active: true,
          updatedById: updatedById ?? null,
        },
        update: {
          imageUrl: result.secureUrl,
          imagePublicId: result.publicId,
          deletedAt: null,
          updatedById: updatedById ?? null,
        },
      });
    } catch (err) {
      // DB write failed — clean up the freshly-uploaded asset so it
      // doesn't orphan.
      this.cloudinary
        .delete(result.publicId)
        .catch((e) =>
          this.logger.warn(
            `Cloudinary cleanup failed for orphan ${result.publicId}: ${(e as Error).message}`,
          ),
        );
      throw err;
    }

    // Replace-path: a prior asset existed, now superseded. Delete it
    // fire-and-forget so the next read doesn't keep paying for it.
    if (before?.imagePublicId && before.imagePublicId !== result.publicId) {
      this.cloudinary
        .delete(before.imagePublicId)
        .catch((err) =>
          this.logger.warn(
            `Cloudinary cleanup failed for prior asset ${before.imagePublicId}: ${(err as Error).message}`,
          ),
        );
    }

    await this.audit.record({
      resourceType: 'CONTENT_BLOCK',
      resourceId: slot,
      action: 'UPLOAD',
      prevState: before ? (this.toAuditSnapshot(before) as any) : null,
      newState: this.toAuditSnapshot(row) as any,
      actorId: updatedById,
    });
    await this.invalidateActiveMapCache();
    return this.toDto(row);
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private toDto(row: {
    slot: string;
    imageUrl: string | null;
    imageAlt: string | null;
    eyebrow: string | null;
    headline: string | null;
    subhead: string | null;
    ctaLabel: string | null;
    ctaHref: string | null;
    price: string | null;
    priceCaption: string | null;
    active: boolean;
    startAt: Date | null;
    endAt: Date | null;
    updatedAt: Date;
  }): StorefrontContentBlockDto {
    return {
      slot: row.slot,
      imageUrl: row.imageUrl,
      imageAlt: row.imageAlt,
      eyebrow: row.eyebrow,
      headline: row.headline,
      subhead: row.subhead,
      ctaLabel: row.ctaLabel,
      ctaHref: row.ctaHref,
      price: row.price,
      priceCaption: row.priceCaption,
      active: row.active,
      startAt: row.startAt ? row.startAt.toISOString() : null,
      endAt: row.endAt ? row.endAt.toISOString() : null,
      updatedAt: row.updatedAt,
    };
  }

  private toAuditSnapshot(row: {
    slot: string;
    imageUrl: string | null;
    imagePublicId?: string | null;
    imageAlt?: string | null;
    eyebrow: string | null;
    headline: string | null;
    subhead: string | null;
    ctaLabel: string | null;
    ctaHref: string | null;
    price: string | null;
    priceCaption: string | null;
    active: boolean;
    startAt?: Date | null;
    endAt?: Date | null;
  }): Record<string, unknown> {
    return {
      slot: row.slot,
      imageUrl: row.imageUrl,
      imagePublicId: row.imagePublicId ?? null,
      imageAlt: row.imageAlt ?? null,
      eyebrow: row.eyebrow,
      headline: row.headline,
      subhead: row.subhead,
      ctaLabel: row.ctaLabel,
      ctaHref: row.ctaHref,
      price: row.price,
      priceCaption: row.priceCaption,
      active: row.active,
      startAt: row.startAt ? row.startAt.toISOString() : null,
      endAt: row.endAt ? row.endAt.toISOString() : null,
    };
  }
}
