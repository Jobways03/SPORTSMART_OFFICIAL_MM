import 'reflect-metadata';
import {
  computeValidityDays,
  computeValidUntil,
} from '../../src/modules/tax/domain/eway-bill-validity';

// Phase 15 GST — EWB validity slab table.
//
// Per CBIC Rule 138(10):
//   ≤ 100 km            → 1 day
//   each additional 200 km (or part thereof) → +1 day
//   15-day ceiling

describe('computeValidityDays', () => {
  it('returns 1 day for 0 km', () => {
    expect(computeValidityDays(0)).toBe(1);
  });

  it('returns 1 day for 50 km', () => {
    expect(computeValidityDays(50)).toBe(1);
  });

  it('returns 1 day at the 100 km boundary', () => {
    expect(computeValidityDays(100)).toBe(1);
  });

  it('returns 2 days at 101 km (first additional slab)', () => {
    expect(computeValidityDays(101)).toBe(2);
  });

  it('returns 2 days at 300 km (end of first additional slab)', () => {
    expect(computeValidityDays(300)).toBe(2);
  });

  it('returns 3 days at 301 km (start of second additional slab)', () => {
    expect(computeValidityDays(301)).toBe(3);
  });

  it('returns 6 days at 1100 km (5 additional slabs)', () => {
    expect(computeValidityDays(1100)).toBe(6);
  });

  it('caps at 15 days for very long distances', () => {
    expect(computeValidityDays(10_000)).toBe(15);
    expect(computeValidityDays(100_000)).toBe(15);
  });

  it('returns 1 day on invalid input', () => {
    expect(computeValidityDays(NaN)).toBe(1);
    expect(computeValidityDays(-5)).toBe(1);
    // Non-finite inputs (Infinity, NaN) are treated as invalid →
    // default to the safest 1-day slab rather than the 15-day cap.
    expect(computeValidityDays(Infinity)).toBe(1);
  });
});

describe('computeValidUntil', () => {
  it('returns end-of-day-IST for 1-day validity', () => {
    // 14:00 IST = 08:30 UTC on 2026-05-13.
    const issuedAt = new Date(Date.UTC(2026, 4, 13, 8, 30, 0));
    const validUntil = computeValidUntil(issuedAt, 50);
    // End of day IST 2026-05-13 = 23:59:59.999 IST = 18:29:59.999 UTC.
    expect(validUntil.toISOString()).toBe('2026-05-13T18:29:59.999Z');
  });

  it('rolls into next IST day correctly for 2-day validity', () => {
    const issuedAt = new Date(Date.UTC(2026, 4, 13, 8, 30, 0));
    const validUntil = computeValidUntil(issuedAt, 200);
    // 2 days → end of IST 2026-05-14 = 18:29:59.999 UTC on 14th.
    expect(validUntil.toISOString()).toBe('2026-05-14T18:29:59.999Z');
  });

  it('handles late-evening-IST issuance correctly', () => {
    // 23:30 IST 2026-05-13 = 18:00 UTC same day. EWB issued just
    // before midnight IST should still expire at end-of-day-IST on
    // the SAME calendar day (1-day validity → today), not next.
    const issuedAt = new Date(Date.UTC(2026, 4, 13, 18, 0, 0));
    const validUntil = computeValidUntil(issuedAt, 50);
    expect(validUntil.toISOString()).toBe('2026-05-13T18:29:59.999Z');
  });
});
