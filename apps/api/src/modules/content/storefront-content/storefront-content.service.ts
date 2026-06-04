import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../bootstrap/cache/redis.service';
import { MediaStorageAdapter } from '../../../integrations/media/media-storage.adapter';
import { ContentAuditService } from './content-audit.service';
import { ConflictAppException } from '../../../core/exceptions';

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
 *   - imagePublicId persisted alongside imageUrl so media
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
  // Phase 48 (Finding #3) — device-targeted artwork + visibility. The
  // storefront picks imageUrlMobile on small viewports and honours
  // deviceVisibility (ALL / DESKTOP_ONLY / MOBILE_ONLY) client-side.
  imageUrlMobile: string | null;
  deviceVisibility: string;
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
  // Phase 48 (Finding #21) — optimistic-concurrency token surfaced so
  // the admin UI can echo it back on the next write.
  version: number;
  updatedAt: Date;
}

export interface UpsertStorefrontContentInput {
  imageUrl?: string | null;
  imageUrlMobile?: string | null;
  deviceVisibility?: string;
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
  // Phase 48 (Finding #21) — when provided on an UPDATE, the service
  // 409s if the row's current version has moved past it. Optional so
  // existing callers (and the upload path) are unaffected.
  expectedVersion?: number;
}

@Injectable()
export class StorefrontContentService {
  private readonly logger = new Logger(StorefrontContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaStorageAdapter,
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

    // Phase 48 (Finding #21) — optimistic concurrency. When the caller
    // sends the version it last read and the row has since moved on,
    // reject so the second admin's blind overwrite doesn't clobber the
    // first's edit. Pre-read guard gives a clean message; the CAS in
    // the UPDATE where-clause below closes the read→write race window.
    if (
      before &&
      input.expectedVersion !== undefined &&
      before.version !== input.expectedVersion
    ) {
      throw new ConflictAppException(
        'another admin updated this slot; reload and retry',
      );
    }

    let row;
    if (before) {
      // `undefined` leaves a field untouched; explicit null clears it.
      const data = {
        imageUrl: input.imageUrl === undefined ? undefined : input.imageUrl,
        imageUrlMobile:
          input.imageUrlMobile === undefined ? undefined : input.imageUrlMobile,
        deviceVisibility:
          input.deviceVisibility === undefined
            ? undefined
            : (input.deviceVisibility as any),
        imageAlt: input.imageAlt === undefined ? undefined : input.imageAlt,
        eyebrow: input.eyebrow === undefined ? undefined : input.eyebrow,
        headline: input.headline === undefined ? undefined : input.headline,
        subhead: input.subhead === undefined ? undefined : input.subhead,
        ctaLabel: input.ctaLabel === undefined ? undefined : input.ctaLabel,
        ctaHref: input.ctaHref === undefined ? undefined : input.ctaHref,
        price: input.price === undefined ? undefined : input.price,
        priceCaption:
          input.priceCaption === undefined ? undefined : input.priceCaption,
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
        // Phase 48 (Finding #21) — every update advances the version.
        version: { increment: 1 },
        updatedById: updatedById ?? null,
      };
      try {
        row = await this.prisma.storefrontContentBlock.update({
          // CAS: when expectedVersion was supplied, pin the update to
          // that exact version so a concurrent bump between our read and
          // write fails the match (P2025) rather than silently winning.
          where:
            input.expectedVersion === undefined
              ? { slot }
              : { slot, version: input.expectedVersion },
          data,
        });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          throw new ConflictAppException(
            'another admin updated this slot; reload and retry',
          );
        }
        throw err;
      }
    } else {
      row = await this.prisma.storefrontContentBlock.create({
        data: {
          slot,
          imageUrl: input.imageUrl ?? null,
          imageUrlMobile: input.imageUrlMobile ?? null,
          deviceVisibility: (input.deviceVisibility ?? undefined) as any,
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
      });
    }

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
   * Phase 47 — reset = soft-delete + media asset cleanup.
   * Pre-Phase-47 the row was hard-deleted and the media asset
   * orphaned. Now the row stays (deletedAt stamped) so the audit log
   * can show the rollback target; media delete is fire-and-
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
      this.media
        .delete(existing.imagePublicId)
        .catch((err) =>
          this.logger.warn(
            `media delete failed for ${existing.imagePublicId}: ${(err as Error).message}`,
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
   * publicId differs from new), the prior media asset is
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

    const result = await this.media.upload(file.buffer, {
      folder: `storefront-content/${slot}`,
      resourceType: 'image',
      // Phase 47 — cap dimensions so a 5000×3000 upload doesn't ship to
      // every storefront client. media's `limit` only scales down.
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
      this.media
        .delete(result.publicId)
        .catch((e) =>
          this.logger.warn(
            `media cleanup failed for orphan ${result.publicId}: ${(e as Error).message}`,
          ),
        );
      throw err;
    }

    // Replace-path: a prior asset existed, now superseded. Delete it
    // fire-and-forget so the next read doesn't keep paying for it.
    if (before?.imagePublicId && before.imagePublicId !== result.publicId) {
      this.media
        .delete(before.imagePublicId)
        .catch((err) =>
          this.logger.warn(
            `media cleanup failed for prior asset ${before.imagePublicId}: ${(err as Error).message}`,
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
    imageUrlMobile?: string | null;
    deviceVisibility?: string | null;
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
    version?: number;
    updatedAt: Date;
  }): StorefrontContentBlockDto {
    return {
      slot: row.slot,
      imageUrl: row.imageUrl,
      imageUrlMobile: row.imageUrlMobile ?? null,
      // Default to ALL so a row written before the column existed (or a
      // partial test fixture) still presents a valid visibility.
      deviceVisibility: row.deviceVisibility ?? 'ALL',
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
      version: row.version ?? 1,
      updatedAt: row.updatedAt,
    };
  }

  private toAuditSnapshot(row: {
    slot: string;
    imageUrl: string | null;
    imageUrlMobile?: string | null;
    deviceVisibility?: string | null;
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
    version?: number;
  }): Record<string, unknown> {
    return {
      slot: row.slot,
      imageUrl: row.imageUrl,
      imageUrlMobile: row.imageUrlMobile ?? null,
      deviceVisibility: row.deviceVisibility ?? 'ALL',
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
      version: row.version ?? 1,
    };
  }
}
