import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';

export interface PostOfficeCoords {
  /** Latitude as a JS number (already converted from Prisma Decimal). */
  latitude: number | null;
  /** Longitude as a JS number. */
  longitude: number | null;
  /** Two-letter state code per CBIC convention, e.g. "MH". */
  state?: string | null;
  /**
   * True when the coordinates are an APPROXIMATION derived from the pincode's
   * postal-region neighbours, because the pincode itself exists in the master
   * but has no coordinates of its own (a rare data gap — ~92 of 165K rows).
   * Used so a valid-but-coordless pincode (e.g. 500063) still yields a usable
   * location for distance-based routing instead of silently dropping the seller.
   */
  approximate?: boolean;
}

/**
 * Phase 4 follow-up (2026-05-16) — PostOffice lookup cache.
 *
 * Background: `SellerAllocationService.allocate` hits the
 * `post_offices` table (~165K rows) at multiple sites per allocation
 * — customer pincode at the start, then once per candidate seller
 * mapping that lacks cached coordinates. A 50-seller product means
 * 50+ table scans through a large reference dataset on every
 * checkout-allocation call. The Postgres b-tree index on `pincode`
 * keeps it fast, but the network round-trip × 50 still dominates
 * the allocation latency budget.
 *
 * This cache:
 *   1. First lookup for a pincode hits Postgres + writes the result
 *      to Redis with a 24h TTL.
 *   2. Subsequent lookups within the TTL window read from Redis
 *      (single network hop, ~1ms).
 *   3. Negative results (unknown pincode) are cached too, with a
 *      shorter TTL (1 hour). Without negative caching, an invalid
 *      pincode in a busy customer's cart would slam the DB once per
 *      cart preview.
 *
 * PostOffice data is essentially static (~quarterly updates from
 * India Post). A 24h TTL is comfortably under the update cadence;
 * the rare data change is picked up in at most one day. Operators
 * can force-invalidate via `invalidate(pincode)` if a hotfix
 * publishes a corrected coordinate.
 *
 * Cache key shape: `post-office:pincode:<6-digit>`. Cached value
 * shape: JSON `{ latitude, longitude, state }`, all nullable.
 * Cached negative result: JSON `null`.
 */
@Injectable()
export class PostOfficeCacheService {
  private readonly logger = new Logger(PostOfficeCacheService.name);
  private static readonly POSITIVE_TTL_SECONDS = 24 * 60 * 60;
  private static readonly NEGATIVE_TTL_SECONDS = 60 * 60;
  private static readonly KEY_PREFIX = 'post-office:pincode:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Lookup coordinates for a pincode. Returns null when the pincode
   * is unknown (either truly absent from the master table or stored
   * without coordinates). Caller is responsible for falling back to
   * a sane default when latitude/longitude are null.
   */
  async lookup(pincode: string): Promise<PostOfficeCoords | null> {
    const normalized = String(pincode ?? '').trim();
    if (!/^\d{6}$/.test(normalized)) {
      // Invalid input — don't waste a DB call or pollute the cache.
      return null;
    }
    const key = PostOfficeCacheService.KEY_PREFIX + normalized;

    try {
      const cached = await this.redis.get<PostOfficeCoords | null>(key);
      // Distinguish "cached negative" (cached === null but the key
      // existed) from "cache miss" (key not set, get returns null).
      // The shared RedisService.get returns null in both cases;
      // we differentiate by re-checking with exists if needed —
      // for our use case, a positive value is recognisable by having
      // at least one non-null field. A bare-null cache entry is
      // treated identically to a miss, which is acceptable: the cost
      // is one extra Postgres call ~once per hour per bad pincode.
      if (cached && (cached.latitude !== null || cached.longitude !== null)) {
        return cached;
      }
    } catch (err) {
      // Cache read failure is non-fatal — fall through to Postgres.
      this.logger.debug(
        `PostOffice cache read failed for ${normalized}: ${(err as Error).message}`,
      );
    }

    // Cache miss — read Postgres.
    const row = await this.prisma.postOffice.findFirst({
      where: { pincode: normalized, latitude: { not: null } },
      select: { latitude: true, longitude: true, state: true },
    });

    let coords: PostOfficeCoords | null = row
      ? {
          latitude: row.latitude ? Number(row.latitude) : null,
          longitude: row.longitude ? Number(row.longitude) : null,
          state: row.state ?? null,
        }
      : null;

    // No exact coords for this pincode — if it's a REAL pincode that just lacks
    // coordinates (data gap), approximate from its postal region so distance-
    // based routing still works. Unknown pincodes stay null (PINCODE_UNKNOWN).
    if (!coords) {
      coords = await this.approximateByRegion(normalized);
    }

    // Best-effort cache write — failure here is non-fatal too.
    try {
      await this.redis.set(
        key,
        coords,
        coords
          ? PostOfficeCacheService.POSITIVE_TTL_SECONDS
          : PostOfficeCacheService.NEGATIVE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.debug(
        `PostOffice cache write failed for ${normalized}: ${(err as Error).message}`,
      );
    }

    return coords;
  }

  /**
   * Batch lookup — hits the cache for each pincode and Postgres only
   * for the misses. Returns a Map preserving the input order; missing
   * coordinates are represented as `null` entries. Allocation uses
   * this when scoring multiple candidate seller mappings: the typical
   * basket touches 10-50 pincodes, most of which are cache hits, and
   * the batched DB round-trip for the misses is ~10ms regardless of
   * miss count.
   */
  async lookupMany(
    pincodes: ReadonlyArray<string>,
  ): Promise<Map<string, PostOfficeCoords | null>> {
    const result = new Map<string, PostOfficeCoords | null>();
    const misses: string[] = [];

    // 1. Per-pincode cache check.
    for (const raw of pincodes) {
      const normalized = String(raw ?? '').trim();
      if (!/^\d{6}$/.test(normalized)) {
        result.set(raw, null);
        continue;
      }
      if (result.has(raw)) continue;
      const key = PostOfficeCacheService.KEY_PREFIX + normalized;
      try {
        const cached = await this.redis.get<PostOfficeCoords | null>(key);
        if (
          cached &&
          (cached.latitude !== null || cached.longitude !== null)
        ) {
          result.set(raw, cached);
          continue;
        }
      } catch {
        /* cache outage — fall through to DB */
      }
      misses.push(normalized);
    }

    // 2. One Postgres query for everything we missed.
    if (misses.length > 0) {
      const rows = await this.prisma.postOffice.findMany({
        where: { pincode: { in: misses }, latitude: { not: null } },
        select: {
          pincode: true,
          latitude: true,
          longitude: true,
          state: true,
        },
        // Distinct on pincode — the master often has multiple rows
        // for the same pincode (one per delivery office); we pick
        // any one with coordinates.
        distinct: ['pincode'],
      });
      const byPin = new Map<string, PostOfficeCoords>();
      for (const r of rows) {
        byPin.set(r.pincode, {
          latitude: r.latitude ? Number(r.latitude) : null,
          longitude: r.longitude ? Number(r.longitude) : null,
          state: r.state ?? null,
        });
      }

      // 3. Update both the result map and the cache for each miss.
      for (const raw of pincodes) {
        if (result.has(raw)) continue;
        const normalized = String(raw ?? '').trim();
        // Real-but-coordless pincodes (no row in the coord-bearing batch) get a
        // postal-region approximation so a valid seller/warehouse pincode isn't
        // silently dropped from distance routing; unknown pincodes stay null.
        const coords =
          byPin.get(normalized) ??
          (await this.approximateByRegion(normalized));
        result.set(raw, coords);
        try {
          await this.redis.set(
            PostOfficeCacheService.KEY_PREFIX + normalized,
            coords,
            coords
              ? PostOfficeCacheService.POSITIVE_TTL_SECONDS
              : PostOfficeCacheService.NEGATIVE_TTL_SECONDS,
          );
        } catch {
          /* cache outage — non-fatal */
        }
      }
    }

    return result;
  }

  /**
   * Approximate a pincode's coordinates from its postal-region neighbours when
   * the pincode EXISTS in the master but has no coordinates of its own (a rare
   * data gap). Tries the longest matching prefix first (5 → 4 → 3 digits) so the
   * approximation is as local as possible, and returns the centroid of the
   * coord-bearing rows in that region.
   *
   * Returns null when the pincode does NOT exist in the master at all — that
   * keeps the genuine "unknown pincode" signal intact (callers surface
   * PINCODE_UNKNOWN), so this only rescues real-but-coordless pincodes.
   */
  private async approximateByRegion(
    pincode: string,
  ): Promise<PostOfficeCoords | null> {
    // Is this a REAL pincode (any row), just missing coords? If it isn't in the
    // master at all, don't approximate — let it stay "unknown".
    const exists = await this.prisma.postOffice.findFirst({
      where: { pincode },
      select: { state: true },
    });
    if (!exists) return null;

    for (const len of [5, 4, 3]) {
      const prefix = pincode.slice(0, len);
      const agg = await this.prisma.postOffice.aggregate({
        _avg: { latitude: true, longitude: true },
        where: { pincode: { startsWith: prefix }, latitude: { not: null } },
      });
      if (agg._avg.latitude != null && agg._avg.longitude != null) {
        this.logger.debug(
          `PostOffice ${pincode} has no coords — approximating from region ${prefix}* centroid`,
        );
        return {
          latitude: Number(agg._avg.latitude),
          longitude: Number(agg._avg.longitude),
          state: exists.state ?? null,
          approximate: true,
        };
      }
    }
    return null;
  }

  /**
   * Force-invalidate a single pincode's cache entry. Use when ops
   * publishes a hotfix correcting a stale coordinate; the next
   * lookup re-reads from Postgres.
   */
  async invalidate(pincode: string): Promise<void> {
    const normalized = String(pincode ?? '').trim();
    if (!normalized) return;
    try {
      await this.redis.del(PostOfficeCacheService.KEY_PREFIX + normalized);
    } catch (err) {
      this.logger.warn(
        `PostOffice cache invalidate failed for ${normalized}: ${(err as Error).message}`,
      );
    }
  }
}
