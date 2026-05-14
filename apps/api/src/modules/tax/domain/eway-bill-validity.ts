// Phase 15 GST — E-way bill validity period from distance.
//
// Per CBIC Rule 138(10): EWB validity is computed from the distance
// the consignment must travel. The "regular" slab table:
//
//   Distance (km) | Validity
//   ---------------+------------------------
//   ≤ 100          | 1 day
//   each +200 km   | +1 day (i.e. 101-300 = 2 days, 301-500 = 3 days)
//   Hard cap        | 15 days for over-dimensional cargo; we cap
//                   |   regular consignments at the same 15-day ceiling
//                   |   for simplicity — the policy doc flags this for
//                   |   CA review.
//
// For Air / Rail / Ship modes, validity rules differ — CBIC has separate
// schedules and the NIC portal applies them itself. Our stub follows the
// road table for all modes; the real NIC adapter (later phase) will
// receive transport_mode and let the portal pick.

/**
 * Compute the validity duration (in days) for an EWB based on the
 * road-distance the consignment travels. Pure function — no I/O.
 *
 * Caller passes `1` for ≤100km, etc. Returns at minimum 1 day.
 */
export function computeValidityDays(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return 1;
  }
  if (distanceKm <= 100) return 1;
  // Each additional 200km (or part thereof) adds 1 day.
  const extra = Math.ceil((distanceKm - 100) / 200);
  // 15-day ceiling matches the over-dimensional cargo policy + keeps
  // the stub deterministic for far-from-realistic test distances.
  return Math.min(1 + extra, 15);
}

/**
 * Convenience — returns the `validUntil` Date for an EWB issued at
 * `issuedAt` for a consignment that must travel `distanceKm`. End-of-day
 * IST per CBIC convention (an EWB issued at 14:00 on day 0 is valid
 * through 23:59 IST on day N-1, where N is the validity in days).
 *
 * Implementation: add (days * 24h) - 1ms to issuedAt's IST midnight.
 */
export function computeValidUntil(
  issuedAt: Date,
  distanceKm: number,
): Date {
  const days = computeValidityDays(distanceKm);
  // IST midnight of issuedAt's day = (UTC midnight that day) - 5h30m,
  // then add `days * 24h` and subtract 1ms.
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(issuedAt.getTime() + istOffsetMs);
  // Start of IST day in absolute UTC terms.
  const istDayStart = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()),
  );
  // The IST-day-start in UTC is (UTC midnight) - 5h30m. We need that
  // moment + days*24h - 1ms for the end-of-day-IST cutoff.
  const istDayStartUtc = istDayStart.getTime() - istOffsetMs;
  return new Date(istDayStartUtc + days * 24 * 60 * 60 * 1000 - 1);
}
