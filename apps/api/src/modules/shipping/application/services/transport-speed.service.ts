import { Injectable, Logger } from '@nestjs/common';

import { EnvService } from '../../../../bootstrap/env/env.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { PostOfficeCacheService } from '../../../catalog/application/services/post-office-cache.service';
import { DelhiveryToolsService } from './delhivery-tools.service';

/** Delhivery `transport_speed`: 'F' = Next Day Delivery, 'D' = standard ground. */
export type TransportSpeed = 'F' | 'D';

/**
 * How long to cache a lane's NDD-serviceability answer (expected_tat, mot='N').
 * TAT serviceability is stable day-to-day, so 6h keeps Delhivery calls down
 * without holding a stale answer for long. Only DEFINITIVE answers are cached
 * (a transient API error is never cached, so the next booking retries).
 */
const NDD_TAT_TTL_SECONDS = 6 * 60 * 60;

/**
 * Great-circle distance between two lat/long points, in kilometres.
 * Pure + exported so the F/D boundary is unit-testable without DB or DI.
 * (Mirrors the haversine in seller-allocation.service.ts.)
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius, km
  const toRad = (d: number) => d * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Hour-of-day (0–23) for an instant, in India Standard Time. IST is a FIXED
 * UTC+5:30 with no daylight saving, so a plain offset is exact — no ICU/library
 * dependency, no DST edge cases. Pure + exported so the cutoff is unit-testable.
 */
export function istHour(date: Date): number {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCHours();
}

/**
 * Decides Delhivery's `transport_speed` (F = Next Day Delivery, D = standard)
 * for a forward shipment, from the pickup→drop distance AND the daily cutoff.
 *
 * Rule (per the NDD routing requirement):
 *   • distance ≤ NDD_MAX_DISTANCE_KM  → 'F' (NDD)
 *   • distance >  NDD_MAX_DISTANCE_KM → 'D' (standard)
 *
 * Fail-safe to 'D' (never silently book the priced-up NDD lane) when:
 *   • the NDD_ENABLED feature flag is off (default),
 *   • the shipment is reverse/RTO (Delhivery NDD is forward-only),
 *   • the booking is at/after the daily pickup cutoff (NDD_CUTOFF_HOUR, IST) —
 *     a parcel booked too late can't make tonight's line-haul, so an 'F' it
 *     can't honour would just cost the premium for a next-day-anyway delivery,
 *   • Delhivery doesn't actually run next-day on the lane — confirmed via their
 *     expected_tat API (mot='N'); any non-next-day TAT, error, or ambiguity
 *     books 'D' (gated by NDD_TAT_CHECK_ENABLED so ops can disable just this),
 *   • either pincode is missing/unknown, or any lookup errors.
 *
 * Distance uses pincode CENTROID coordinates from the shared PostOffice cache,
 * so it is an approximate business gate, not a GPS-exact measure — fine for a
 * 50 km cut. A real-but-coordless pincode is rescued by the cache's postal-
 * region approximation, so only a genuinely unknown pincode fails to 'D'.
 */
@Injectable()
export class TransportSpeedService {
  private readonly logger = new Logger(TransportSpeedService.name);

  constructor(
    private readonly postOffice: PostOfficeCacheService,
    private readonly env: EnvService,
    private readonly delhiveryTools: DelhiveryToolsService,
    private readonly redis: RedisService,
  ) {}

  /** Current instant. Isolated as a method so tests can pin "now". */
  protected now(): Date {
    return new Date();
  }

  async resolve(args: {
    pickupPincode?: string | null;
    dropPincode?: string | null;
    direction?: 'forward' | 'reverse';
  }): Promise<TransportSpeed> {
    // Off by default — nothing changes until NDD is explicitly enabled.
    if (!this.env.getBoolean('NDD_ENABLED', false)) return 'D';
    // NDD is forward-only; reverse pickups always ship standard.
    if (args.direction === 'reverse') return 'D';

    const pickup = (args.pickupPincode ?? '').trim();
    const drop = (args.dropPincode ?? '').trim();
    if (!/^\d{6}$/.test(pickup) || !/^\d{6}$/.test(drop)) return 'D';

    try {
      const [pc, dc] = await Promise.all([
        this.coordsOf(pickup),
        this.coordsOf(drop),
      ]);
      if (!pc || !dc) return 'D';

      const km = haversineKm(pc.lat, pc.lon, dc.lat, dc.lon);
      const maxKm = this.env.getNumber('NDD_MAX_DISTANCE_KM', 50);
      if (km > maxKm) {
        this.logger.log(
          `transport_speed=D for ${pickup}→${drop} (${km.toFixed(1)}km > max=${maxKm}km)`,
        );
        return 'D';
      }

      // Near enough for NDD — but only if we're before today's pickup cutoff.
      // Past it, the parcel can't make tonight's line-haul, so book standard
      // 'D' rather than charge for a next-day we can't deliver.
      const cutoffHour = this.env.getNumber('NDD_CUTOFF_HOUR', 14);
      const hour = istHour(this.now());
      if (hour >= cutoffHour) {
        this.logger.log(
          `transport_speed=D for ${pickup}→${drop} (${km.toFixed(1)}km within ${maxKm}km, but ${hour}:00 IST ≥ ${cutoffHour}:00 cutoff)`,
        );
        return 'D';
      }

      // Final gate: distance + cutoff say NDD, but confirm Delhivery actually
      // RUNS next-day on this lane (a near route can still be surface-only).
      // Fail-closed — if we can't confirm it, book standard 'D'.
      if (
        this.env.getBoolean('NDD_TAT_CHECK_ENABLED', true) &&
        !(await this.isNddServiceable(pickup, drop))
      ) {
        this.logger.log(
          `transport_speed=D for ${pickup}→${drop} (${km.toFixed(1)}km within cutoff, but Delhivery NDD not serviceable on this lane)`,
        );
        return 'D';
      }

      this.logger.log(
        `transport_speed=F for ${pickup}→${drop} (${km.toFixed(1)}km within ${maxKm}km, ${hour}:00 IST < ${cutoffHour}:00 cutoff)`,
      );
      return 'F';
    } catch (err) {
      // Fail closed — a lookup failure must not block the booking nor
      // accidentally upgrade it to the paid NDD lane.
      this.logger.warn(
        `transport_speed resolution failed for ${pickup}→${drop}, defaulting to 'D': ${(err as Error).message}`,
      );
      return 'D';
    }
  }

  /**
   * Pincode → centroid coords via the shared Redis-backed PostOffice cache
   * (same lookup allocation uses). Returns null when the pincode is unknown or
   * has no usable coordinates. For a real-but-coordless pincode the cache
   * supplies a postal-region approximation, so a valid near route still books
   * NDD instead of silently falling back to 'D'.
   */
  private async coordsOf(
    pincode: string,
  ): Promise<{ lat: number; lon: number } | null> {
    const coords = await this.postOffice.lookup(pincode);
    if (!coords || coords.latitude == null || coords.longitude == null) {
      return null;
    }
    return { lat: coords.latitude, lon: coords.longitude };
  }

  /**
   * Whether Delhivery actually runs Next-Day delivery on this lane, via the
   * existing expected_tat tool with mot='N' (Next-Day). NDD is serviceable only
   * when Delhivery returns a definite next-day TAT (≤ 1 day). FAIL-CLOSED:
   * a missing/>1 TAT, an error, or any ambiguity returns false → caller books
   * standard 'D'. Result is cached per lane (definitive answers only — a
   * transient API error is never cached, so the next booking retries).
   */
  private async isNddServiceable(
    origin: string,
    drop: string,
  ): Promise<boolean> {
    const key = `ndd:tat:N:${origin}:${drop}`;

    try {
      const cached = await this.redis.get<boolean>(key);
      if (typeof cached === 'boolean') return cached;
    } catch {
      // Cache outage — fall through and ask Delhivery directly.
    }

    let res: { tatDays?: number; raw?: { tat?: number | string } };
    try {
      res = await this.delhiveryTools.expectedTat({
        origin,
        destination: drop,
        mot: 'N', // Next-Day
      });
    } catch (err) {
      // Transient/unknown error — fail closed, but DON'T cache it so the next
      // booking retries rather than being stuck on a poisoned 'not serviceable'.
      this.logger.warn(
        `expected_tat(N) failed for ${origin}→${drop}, treating NDD as unserviceable: ${(err as Error).message}`,
      );
      return false;
    }

    const tatDays = Number(res?.tatDays ?? res?.raw?.tat);
    const serviceable = Number.isFinite(tatDays) && tatDays <= 1;

    // Delhivery answered — cache the definitive verdict to spare the lane a
    // repeat call within the TTL.
    try {
      await this.redis.set(key, serviceable, NDD_TAT_TTL_SECONDS);
    } catch {
      // Cache write failure is non-fatal.
    }
    return serviceable;
  }
}
