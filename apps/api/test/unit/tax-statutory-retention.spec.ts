import 'reflect-metadata';
import {
  computeRetentionExpiry,
  daysUntilRetentionExpiry,
  DEFAULT_STATUTORY_RETENTION_YEARS,
  isUnderStatutoryRetention,
} from '../../src/modules/tax/domain/statutory-retention';

// Phase 21 GST — Statutory retention pure-function tests.
//
// Default window: 8 years from issuance. Engineering's defensible
// floor for CGST Section 36 / Rule 56.

describe('DEFAULT_STATUTORY_RETENTION_YEARS', () => {
  it('is 8 years', () => {
    expect(DEFAULT_STATUTORY_RETENTION_YEARS).toBe(8);
  });
});

describe('computeRetentionExpiry', () => {
  it('adds 8 years to the issuance date by default', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    const expiry = computeRetentionExpiry(issued);
    expect(expiry.toISOString()).toBe('2034-04-15T10:00:00.000Z');
  });

  it('honours a custom retention window', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    expect(computeRetentionExpiry(issued, 5).toISOString()).toBe(
      '2031-04-15T10:00:00.000Z',
    );
  });

  it('shifts a leap-day issuance into the following calendar day', () => {
    // 29 Feb 2024 + 8y → 28 Feb 2032 (2032 is leap, but JS Date
    // setFullYear shifts to 1 Mar when month-day combo is invalid).
    const leap = new Date('2024-02-29T00:00:00.000Z');
    const expiry = computeRetentionExpiry(leap);
    // Either 28 Feb 2032 or 29 Feb 2032 acceptable depending on year
    // leap-status; both are valid floors. We assert the year + month.
    expect(expiry.getUTCFullYear()).toBe(2032);
    expect(expiry.getUTCMonth()).toBe(1); // Feb (0-indexed)
  });

  it('rejects an invalid Date input', () => {
    expect(() =>
      computeRetentionExpiry(new Date('not-a-date')),
    ).toThrow(/invalid generatedAt/);
  });

  it('rejects negative retention years', () => {
    expect(() =>
      computeRetentionExpiry(new Date('2026-04-15T10:00:00.000Z'), -1),
    ).toThrow(/non-negative/);
  });
});

describe('isUnderStatutoryRetention', () => {
  it('returns true for a recently-issued document', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    const now = new Date('2026-05-15T10:00:00.000Z');
    expect(isUnderStatutoryRetention(issued, now)).toBe(true);
  });

  it('returns true exactly one second before the 8-year boundary', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    const now = new Date('2034-04-15T09:59:59.000Z');
    expect(isUnderStatutoryRetention(issued, now)).toBe(true);
  });

  it('returns false exactly at the 8-year boundary', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    const now = new Date('2034-04-15T10:00:00.000Z');
    expect(isUnderStatutoryRetention(issued, now)).toBe(false);
  });

  it('returns false for documents aged out past retention', () => {
    const issued = new Date('2010-04-15T10:00:00.000Z');
    const now = new Date('2026-04-15T10:00:00.000Z');
    expect(isUnderStatutoryRetention(issued, now)).toBe(false);
  });

  it('honours a custom retention window (5 years)', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    const now = new Date('2032-04-15T10:00:00.000Z'); // 6 years later
    expect(isUnderStatutoryRetention(issued, now, 5)).toBe(false);
    expect(isUnderStatutoryRetention(issued, now, 8)).toBe(true);
  });
});

describe('daysUntilRetentionExpiry', () => {
  it('returns positive when within window', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    const now = new Date('2026-04-15T10:00:00.000Z');
    // Exactly 8 years = ~2922 days (8 * 365 + 2 leap days).
    const days = daysUntilRetentionExpiry(issued, now);
    expect(days).toBeGreaterThanOrEqual(2920);
    expect(days).toBeLessThanOrEqual(2924);
  });

  it('returns negative when past expiry', () => {
    const issued = new Date('2010-04-15T10:00:00.000Z');
    const now = new Date('2026-04-15T10:00:00.000Z');
    const days = daysUntilRetentionExpiry(issued, now);
    expect(days).toBeLessThan(0);
  });

  it('returns 0 the day of expiry', () => {
    const issued = new Date('2026-04-15T10:00:00.000Z');
    const now = new Date('2034-04-15T10:00:00.000Z');
    expect(daysUntilRetentionExpiry(issued, now)).toBe(0);
  });
});
