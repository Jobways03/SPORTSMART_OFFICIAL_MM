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
  // A single pincode's post offices physically cluster within a few km; a row
  // sitting farther than this from the pincode's median coordinate is treated as
  // a corrupt source geocode and trimmed before averaging (see
  // resolveRepresentativeCoords). Generous enough never to drop a legitimate
  // intra-pincode office, tight enough to reject the tens-of-km source errors.
  private static readonly MAX_INTRA_PINCODE_SPREAD_KM = 15;

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

    // Cache miss — read Postgres. A pincode legitimately maps to MANY post
    // offices, each carrying its own coordinates, and the India-Post source has
    // corrupt geocodes for some rows (e.g. 500056's Non-Delivery "Neredmet S.O"
    // sat ~57 km from the real pincode, wrongly failing the 50 km retail gate).
    // Pull ALL coord-bearing offices and resolve ONE robust, DETERMINISTIC
    // representative coordinate, instead of the old findFirst that returned an
    // arbitrary — sometimes corrupt — row.
    const rows = await this.prisma.postOffice.findMany({
      where: {
        pincode: normalized,
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        latitude: true,
        longitude: true,
        state: true,
        delivery: true,
        officeName: true,
      },
      orderBy: { officeName: 'asc' },
    });

    let coords: PostOfficeCoords | null =
      await this.resolveRepresentativeCoords(normalized, rows);

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
      // Pull ALL coord-bearing offices for the missed pincodes (NOT distinct):
      // a pincode maps to many offices and some source coordinates are corrupt,
      // so we group by pincode and resolve ONE robust representative each (same
      // logic as the single lookup), rather than picking an arbitrary row.
      const rows = await this.prisma.postOffice.findMany({
        where: {
          pincode: { in: misses },
          latitude: { not: null },
          longitude: { not: null },
        },
        select: {
          pincode: true,
          latitude: true,
          longitude: true,
          state: true,
          delivery: true,
          officeName: true,
        },
        orderBy: { officeName: 'asc' },
      });
      const officesByPin = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = officesByPin.get(r.pincode);
        if (list) list.push(r);
        else officesByPin.set(r.pincode, [r]);
      }
      const byPin = new Map<string, PostOfficeCoords>();
      for (const [pin, offices] of officesByPin) {
        const resolved = await this.resolveRepresentativeCoords(pin, offices);
        if (resolved) byPin.set(pin, resolved);
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
   * Resolve ONE robust, deterministic coordinate for a pincode from ALL its
   * coord-bearing post offices.
   *
   * A pincode legitimately maps to many post offices, and the India-Post source
   * carries corrupt geocodes for some rows — e.g. pincode 500056 had a
   * Non-Delivery office ("Neredmet S.O") sitting ~57 km from the real pincode,
   * alongside the accurate Delivery office ("Ramakrishna Puram S.O"). The old
   * `findFirst` / `distinct` pick returned an arbitrary — sometimes corrupt — row,
   * so a genuinely-local retail seller could fail the 50 km serviceability gate,
   * and it did so NON-deterministically (the same pincode could flip between
   * requests). This resolves a single representative coordinate:
   *
   *   1. Prefer DELIVERY offices when the pincode has any — they are the
   *      authoritative delivery points and empirically the better-geocoded rows
   *      (the corrupt outlier is most often a Non-Delivery sub-office).
   *   2. Anchor on the component-wise MEDIAN of the chosen pool (a single corrupt
   *      row cannot drag a median), trim offices farther than
   *      MAX_INTRA_PINCODE_SPREAD_KM from it, then average the survivors.
   *
   * Deterministic: offices are name-sorted and median/mean are order-independent,
   * so a pincode always resolves to the same point. Returns null when no office
   * has usable coordinates (the caller then approximates by region or surfaces
   * PINCODE_UNKNOWN) — so coordless / unknown pincodes behave exactly as before.
   */
  private async resolveRepresentativeCoords(
    pincode: string,
    rows: ReadonlyArray<{
      latitude: unknown;
      longitude: unknown;
      state: string | null;
      delivery: string | null;
      officeName: string | null;
    }>,
  ): Promise<PostOfficeCoords | null> {
    const offices = rows
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => ({
        lat: Number(r.latitude),
        lon: Number(r.longitude),
        state: r.state ?? null,
        isDelivery: String(r.delivery ?? '').trim().toLowerCase() === 'delivery',
        officeName: r.officeName ?? '',
      }))
      .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon))
      .sort((a, b) => a.officeName.localeCompare(b.officeName));

    if (offices.length === 0) return null;

    // 1. Prefer Delivery offices when the pincode has any — authoritative and
    //    best-geocoded; the corrupt outlier is usually a Non-Delivery sub-office.
    const deliveryOffices = offices.filter((o) => o.isDelivery);
    const pool = deliveryOffices.length > 0 ? deliveryOffices : offices;

    if (pool.length === 1) {
      const only = pool[0]!;
      return { latitude: only.lat, longitude: only.lon, state: only.state };
    }

    // 2. Anchor on the pool's component-wise MEDIAN and find the offices that
    //    cluster around it (a single corrupt row cannot drag a median).
    const medLat = PostOfficeCacheService.median(pool.map((o) => o.lat));
    const medLon = PostOfficeCacheService.median(pool.map((o) => o.lon));
    const nearMedian = pool.filter(
      (o) =>
        PostOfficeCacheService.haversineKm(o.lat, o.lon, medLat, medLon) <=
        PostOfficeCacheService.MAX_INTRA_PINCODE_SPREAD_KM,
    );

    // 3. Common case: a MAJORITY of the pool clusters around the median, so that
    //    cluster is the real location (tight cluster, or cluster + minority
    //    outliers). Use its centroid — no extra query needed.
    if (nearMedian.length * 2 > pool.length) {
      return PostOfficeCacheService.centroidOf(nearMedian);
    }

    // 4. No majority cluster — the pool splits into far-apart groups (e.g. two
    //    Delivery offices tens of km apart, one a corrupt geocode), so the pool's
    //    own median floats between them. Anchor on the POSTAL-REGION centroid (a
    //    robust average over many pincodes that no single bad row can move) and
    //    keep the cluster nearest it; fall back to the median when the region has
    //    no coordinates at all.
    const anchor = await this.regionCentroid(pincode);
    const ref = anchor ?? { lat: medLat, lon: medLon };
    const seed = pool.reduce(
      (best, o) =>
        PostOfficeCacheService.haversineKm(o.lat, o.lon, ref.lat, ref.lon) <
        PostOfficeCacheService.haversineKm(best.lat, best.lon, ref.lat, ref.lon)
          ? o
          : best,
      pool[0]!,
    );
    const cluster = pool.filter(
      (o) =>
        PostOfficeCacheService.haversineKm(o.lat, o.lon, seed.lat, seed.lon) <=
        PostOfficeCacheService.MAX_INTRA_PINCODE_SPREAD_KM,
    );
    return PostOfficeCacheService.centroidOf(cluster);
  }

  /**
   * Mean coordinate of a non-empty office list, with `state` taken from the
   * office nearest the mean (deterministic — callers pass name-sorted lists, so
   * equidistant ties resolve to the earliest name).
   */
  private static centroidOf(
    offices: ReadonlyArray<{ lat: number; lon: number; state: string | null }>,
  ): PostOfficeCoords {
    const meanLat = offices.reduce((s, o) => s + o.lat, 0) / offices.length;
    const meanLon = offices.reduce((s, o) => s + o.lon, 0) / offices.length;
    const rep = offices.reduce(
      (best, o) =>
        PostOfficeCacheService.haversineKm(o.lat, o.lon, meanLat, meanLon) <
        PostOfficeCacheService.haversineKm(best.lat, best.lon, meanLat, meanLon)
          ? o
          : best,
      offices[0]!,
    );
    return { latitude: meanLat, longitude: meanLon, state: rep.state };
  }

  /**
   * Postal-region centroid: the mean coordinate over the longest matching pincode
   * prefix (5 → 4 → 3 digits). Robust to a handful of corrupt rows because it
   * averages over many offices. Returns null only when the region has no
   * coordinate-bearing offices at all. Shared by the multi-office tie-break above
   * and the coordless-pincode approximation below.
   */
  private async regionCentroid(
    pincode: string,
  ): Promise<{ lat: number; lon: number } | null> {
    for (const len of [5, 4, 3]) {
      const prefix = pincode.slice(0, len);
      const agg = await this.prisma.postOffice.aggregate({
        _avg: { latitude: true, longitude: true },
        where: {
          pincode: { startsWith: prefix },
          latitude: { not: null },
          longitude: { not: null },
        },
      });
      if (agg._avg.latitude != null && agg._avg.longitude != null) {
        this.logger.debug(
          `PostOffice region centroid for ${pincode} resolved from ${prefix}* prefix`,
        );
        return {
          lat: Number(agg._avg.latitude),
          lon: Number(agg._avg.longitude),
        };
      }
    }
    return null;
  }

  /** Component-wise median — outlier-resistant centre for >= 3 values. */
  private static median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  }

  /** Great-circle distance in km between two lat/long points. */
  private static haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

    const centroid = await this.regionCentroid(pincode);
    if (!centroid) return null;
    this.logger.debug(
      `PostOffice ${pincode} has no coords — approximating from postal-region centroid`,
    );
    return {
      latitude: centroid.lat,
      longitude: centroid.lon,
      state: exists.state ?? null,
      approximate: true,
    };
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
