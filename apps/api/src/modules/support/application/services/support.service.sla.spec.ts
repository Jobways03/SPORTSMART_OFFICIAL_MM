/**
 * Phase 15 (2026-05-16) — first behavioural test for the support
 * module. Pre-Phase-15 the module had zero specs.
 *
 * `computeSlaTarget` is the pure helper that every ticket-create
 * and reply path uses to set `slaTargetAt`. Two modes:
 *
 *   • Wall-clock SLA (default): `from + hours`, no business-hour
 *     accounting. Used when `businessHoursEnabled=false`.
 *   • Business-hour SLA: only IST business hours (Mon-Fri,
 *     `businessHourStart`–`businessHourEnd`) count. Saturdays +
 *     Sundays freeze the clock entirely.
 *
 * We don't need any mocks here — the helper is a pure function over
 * (priority, fromDate, config).
 */
import 'reflect-metadata';
import { computeSlaTarget, SlaConfig } from './support.service';

describe('computeSlaTarget (Phase 15)', () => {
  describe('wall-clock mode (businessHoursEnabled=false)', () => {
    it('URGENT priority adds 4h to the from-date', () => {
      const from = new Date('2026-05-16T10:00:00Z');
      const result = computeSlaTarget('URGENT', from);
      expect(result.getTime() - from.getTime()).toBe(4 * 60 * 60 * 1000);
    });

    it('HIGH priority adds 24h', () => {
      const from = new Date('2026-05-16T10:00:00Z');
      const result = computeSlaTarget('HIGH', from);
      expect(result.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('NORMAL priority adds 48h', () => {
      const from = new Date('2026-05-16T10:00:00Z');
      const result = computeSlaTarget('NORMAL', from);
      expect(result.getTime() - from.getTime()).toBe(48 * 60 * 60 * 1000);
    });

    it('LOW priority adds 5 days (120h)', () => {
      const from = new Date('2026-05-16T10:00:00Z');
      const result = computeSlaTarget('LOW', from);
      expect(result.getTime() - from.getTime()).toBe(5 * 24 * 60 * 60 * 1000);
    });
  });

  describe('business-hours mode (businessHoursEnabled=true)', () => {
    const cfg: SlaConfig = {
      businessHoursEnabled: true,
      businessHourStart: 9,   // 09:00 IST
      businessHourEnd: 19,    // 19:00 IST
    };

    it('a 4h URGENT SLA started at 10:00 IST Monday completes by 14:00 IST same Monday', () => {
      // 10:00 IST = 04:30 UTC
      const from = new Date('2026-05-18T04:30:00Z'); // Mon 2026-05-18
      const result = computeSlaTarget('URGENT', from, cfg);
      // 4h later (still within business hours) = 14:00 IST = 08:30 UTC
      // 15-min granular stepping means result is within +/-15 min of exact.
      const expected = new Date('2026-05-18T08:30:00Z');
      const diff = Math.abs(result.getTime() - expected.getTime());
      // Step size is 15 min, so the result lands within one step.
      expect(diff).toBeLessThanOrEqual(16 * 60 * 1000);
    });

    it('an SLA crossing weekend pauses on Saturday + Sunday', () => {
      // Started 17:00 IST Friday (= 11:30 UTC).
      // 4h of business time should land 11:00 IST Monday (3h Mon to consume
      // remaining 3h after burning 2h Fri evening 17:00–19:00).
      // Let's sanity-check that Sunday's wall-clock isn't consumed:
      const fridayEvening = new Date('2026-05-15T11:30:00Z'); // Fri 17:00 IST
      const target = computeSlaTarget('URGENT', fridayEvening, cfg);
      // Diff must exceed 48 hours (wall-clock weekend skipped).
      expect(target.getTime() - fridayEvening.getTime()).toBeGreaterThan(
        48 * 60 * 60 * 1000,
      );
    });

    it('still uses the wall-clock SLA when config disables business hours', () => {
      const from = new Date('2026-05-16T10:00:00Z');
      const result = computeSlaTarget('NORMAL', from, {
        ...cfg,
        businessHoursEnabled: false,
      });
      expect(result.getTime() - from.getTime()).toBe(48 * 60 * 60 * 1000);
    });
  });

  it('falls back to 48h when an unknown priority is passed (defensive)', () => {
    const from = new Date('2026-05-16T10:00:00Z');
    const result = computeSlaTarget('UNKNOWN' as any, from);
    expect(result.getTime() - from.getTime()).toBe(48 * 60 * 60 * 1000);
  });
});
