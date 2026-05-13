import { toPaise } from './money-field-registry';

/**
 * Phase 0 (PR 0.4) — `toPaise` precision audit.
 *
 * The previous implementation did `BigInt(roundHalfAwayFromZero(d.toNumber() * 100))`.
 * `.toNumber()` is lossy for >2^53 paise; `* 100` introduces classic
 * float-binary-repr drift (the infamous `0.1 + 0.2 === 0.3 // false`).
 * This rewrite uses exact string / Decimal arithmetic so there is no
 * code path that lets a JS float touch a money value.
 *
 * These tests enforce the contract going forward; the integration into
 * `MoneyDualWriteHelper` is exercised separately in
 * `test/unit/money-dual-write-helper.spec.ts`.
 */

/** Tiny Decimal-like for tests — same shape the helper duck-types on. */
function decimal(s: string) {
  const obj = {
    _s: s,
    mul(factor: number) {
      if (factor !== 100) throw new Error('test decimal().mul only supports *100');
      const neg = s.startsWith('-');
      const u = neg ? s.slice(1) : s;
      const [i, f = ''] = u.split('.');
      const padded = (f + '00').slice(0, Math.max(2, f.length));
      const shifted =
        padded.length >= 2
          ? i + padded.slice(0, 2) + (padded.length > 2 ? '.' + padded.slice(2) : '')
          : i + padded;
      const trimmed = shifted.replace(/^0+(?=\d)/, '') || '0';
      return decimal((neg ? '-' : '') + trimmed);
    },
    toFixed(d: number) {
      if (d !== 0) throw new Error('test decimal().toFixed only supports digits=0');
      const neg = obj._s.startsWith('-');
      const u = neg ? obj._s.slice(1) : obj._s;
      const [i, f = ''] = u.split('.');
      const roundDigit = f.charCodeAt(0) - 48;
      let n = BigInt(i.replace(/^0+(?=\d)/, '') || '0');
      if (roundDigit >= 5) n += 1n;
      return (neg ? '-' : '') + n.toString();
    },
  };
  return obj;
}

describe('toPaise — Phase 0 (PR 0.4)', () => {
  // ── null / undefined ─────────────────────────────────────────────

  it('returns null for null', () => {
    expect(toPaise(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(toPaise(undefined)).toBeNull();
  });

  // ── Decimal-like (the preferred production path) ─────────────────

  it('converts Decimal("999.99") to 99999n exactly', () => {
    expect(toPaise(decimal('999.99'))).toBe(99999n);
  });

  it('converts Decimal("0.30") to 30n (the canonical 0.1+0.2 trap, pre-summed by Decimal)', () => {
    expect(toPaise(decimal('0.30'))).toBe(30n);
  });

  it('converts a very large Decimal to BigInt paise without precision loss', () => {
    // ₹100,000,000,000.45 → 10,000,000,000,045 paise. Above 2^33,
    // well below 2^53, but the same code path scales to 10^18 paise
    // (which `Number` cannot represent).
    expect(toPaise(decimal('100000000000.45'))).toBe(10_000_000_000_045n);
  });

  it('converts a negative Decimal preserving sign', () => {
    expect(toPaise(decimal('-50.50'))).toBe(-5050n);
  });

  // ── strings (the JSON / DTO path) ────────────────────────────────

  it('parses "1234567890.45" as 123456789045n', () => {
    expect(toPaise('1234567890.45')).toBe(123_456_789_045n);
  });

  it('rounds string halves up (positive)', () => {
    expect(toPaise('0.005')).toBe(1n);
  });

  it('rounds string halves away from zero (negative)', () => {
    expect(toPaise('-0.005')).toBe(-1n);
  });

  it('truncates beyond the third decimal to maintain deterministic rounding', () => {
    // "0.0049" → 0.49 paise → round-half-up at digit 3 (4 < 5) → 0
    expect(toPaise('0.0049')).toBe(0n);
    // "0.0051" → 0.51 paise → round-half-up at digit 3 (5 >= 5) → 1
    expect(toPaise('0.0051')).toBe(1n);
  });

  it('handles integer-only strings', () => {
    expect(toPaise('123')).toBe(12300n);
  });

  it('handles "0" string', () => {
    expect(toPaise('0')).toBe(0n);
  });

  it('returns null for a malformed string', () => {
    expect(toPaise('not-a-number')).toBeNull();
    expect(toPaise('12.34.56')).toBeNull();
    expect(toPaise('')).toBeNull();
  });

  // ── integer numbers (safe enough) ────────────────────────────────

  it('accepts integer JS Number (whole rupees), routes via BigInt', () => {
    expect(toPaise(100)).toBe(10000n);
    expect(toPaise(0)).toBe(0n);
    expect(toPaise(-100)).toBe(-10000n);
  });

  // ── fractional numbers — REJECTED ────────────────────────────────

  it('THROWS for a fractional JS Number (precision-loss guard)', () => {
    expect(() => toPaise(12.34)).toThrow(/refusing to convert fractional Number/);
    expect(() => toPaise(0.1 + 0.2)).toThrow(/refusing to convert fractional Number/);
    expect(() => toPaise(-0.005)).toThrow(/refusing to convert fractional Number/);
  });

  it('returns null for non-finite numbers', () => {
    expect(toPaise(Number.NaN)).toBeNull();
    expect(toPaise(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toPaise(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  // ── bigint passthrough ───────────────────────────────────────────

  it('treats bigint input as whole rupees', () => {
    expect(toPaise(100n)).toBe(10000n);
    expect(toPaise(0n)).toBe(0n);
    expect(toPaise(-100n)).toBe(-10000n);
  });

  it('preserves precision for a huge bigint rupee value', () => {
    const huge = 100_000_000_000_000n; // 10^14 rupees
    expect(toPaise(huge)).toBe(huge * 100n); // 10^16 paise — exact
  });

  // ── unknown type ─────────────────────────────────────────────────

  it('returns null for an unknown shape', () => {
    expect(toPaise({ random: 'thing' })).toBeNull();
    expect(toPaise([1, 2, 3])).toBeNull();
    expect(toPaise(true as unknown)).toBeNull();
  });
});
