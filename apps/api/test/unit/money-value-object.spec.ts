import { Money } from '../../src/core/value-objects/money';

/**
 * Unit tests for the Money value object (PR 1.2).
 *
 * Coverage targets:
 *   - Constructor invariants (integer paise, finite, supported currency)
 *   - Rupee → paise rounding (positive, negative, half-paise edge cases)
 *   - Arithmetic preserves currency, rejects mixed currency
 *   - Multiplication rounds via ROUND_HALF_UP symmetrically
 *   - JSON shape matches the wire contract (amountInPaise + currency + displayInr)
 *   - Display string respects en-IN locale
 */
describe('Money', () => {
  // ─── Constructors ─────────────────────────────────────────────────

  describe('fromPaise', () => {
    it('accepts an integer paise amount', () => {
      const m = Money.fromPaise(12345);
      expect(m.amountInPaise).toBe(12345);
      expect(m.currency).toBe('INR');
    });

    it('rejects a fractional paise amount', () => {
      expect(() => Money.fromPaise(12.5)).toThrow(RangeError);
    });

    it('rejects NaN / Infinity', () => {
      expect(() => Money.fromPaise(NaN)).toThrow(RangeError);
      expect(() => Money.fromPaise(Infinity)).toThrow(RangeError);
    });

    it('rejects an unsupported currency', () => {
      expect(() => Money.fromPaise(100, 'USD' as never)).toThrow(TypeError);
    });

    it('accepts negative paise (credits/debits)', () => {
      const m = Money.fromPaise(-500);
      expect(m.amountInPaise).toBe(-500);
      expect(m.isNegative()).toBe(true);
    });
  });

  describe('fromRupees', () => {
    it('rounds 12.34 to 1234 paise exactly', () => {
      expect(Money.fromRupees(12.34).amountInPaise).toBe(1234);
    });

    it('rounds 12.5p to 13p (half-away-from-zero)', () => {
      // Construct an exact .5 boundary in IEEE 754 by multiplying.
      // 0.5 + 12 = 12.5 is exactly representable in float, so
      // 12.5 × 1 paise via multiply rounds cleanly. We use the
      // static helper directly to dodge fromRupees's float trap.
      expect(Money.roundHalfUp(12.5)).toBe(13);
    });

    it('rounds -12.5p to -13p (symmetric, away from zero)', () => {
      // The case JS Math.round gets WRONG by default (-12.5 → -12).
      // Money.roundHalfUp must produce -13 for symmetry.
      expect(Money.roundHalfUp(-12.5)).toBe(-13);
    });

    it('does NOT promise exact half-paise rounding for fromRupees(1.005)', () => {
      // KNOWN LIMITATION: 1.005 cannot be represented exactly in IEEE
      // 754 — the actual stored value is 1.0049999999999999. So
      // multiplying by 100 yields 100.4999... which rounds DOWN to
      // 100p, not 101p. Callers who need exact rounding at half-paise
      // boundaries should pass paise directly via fromPaise.
      // This test pins the current behaviour so no one accidentally
      // "fixes" it by introducing a string-decimal library without a
      // deliberate decision (which would be the right answer if the
      // platform later needs sub-paise precision).
      expect(Money.fromRupees(1.005).amountInPaise).toBe(100);
    });

    it('rejects NaN / Infinity', () => {
      expect(() => Money.fromRupees(NaN)).toThrow(RangeError);
      expect(() => Money.fromRupees(-Infinity)).toThrow(RangeError);
    });

    it('handles zero', () => {
      expect(Money.fromRupees(0).amountInPaise).toBe(0);
    });
  });

  describe('zero', () => {
    it('returns a zero-amount INR money', () => {
      const z = Money.zero();
      expect(z.amountInPaise).toBe(0);
      expect(z.isZero()).toBe(true);
      expect(z.currency).toBe('INR');
    });
  });

  // ─── Arithmetic ───────────────────────────────────────────────────

  describe('add', () => {
    it('sums same-currency Money', () => {
      const a = Money.fromPaise(1000);
      const b = Money.fromPaise(250);
      expect(a.add(b).amountInPaise).toBe(1250);
    });

    it('returns a new instance (immutability)', () => {
      const a = Money.fromPaise(1000);
      const b = Money.fromPaise(250);
      const c = a.add(b);
      expect(c).not.toBe(a);
      expect(c).not.toBe(b);
      expect(a.amountInPaise).toBe(1000);
    });

    it('rejects different currencies', () => {
      const inr = Money.fromPaise(100);
      const fakeUsd = { amountInPaise: 100, currency: 'USD' } as unknown as Money;
      expect(() => inr.add(fakeUsd)).toThrow(TypeError);
    });
  });

  describe('subtract', () => {
    it('produces a negative Money when subtrahend exceeds minuend', () => {
      const a = Money.fromPaise(100);
      const b = Money.fromPaise(250);
      const c = a.subtract(b);
      expect(c.amountInPaise).toBe(-150);
      expect(c.isNegative()).toBe(true);
    });
  });

  describe('multiply', () => {
    it('multiplies by an integer quantity', () => {
      // ₹12.34 × 3 = ₹37.02
      const unit = Money.fromPaise(1234);
      expect(unit.multiply(3).amountInPaise).toBe(3702);
    });

    it('rounds half-paise away from zero on multiplication', () => {
      // ₹12.345 × 1 should round to 1235p (was 1234.5)
      // We can construct via paise to avoid double-rounding:
      // 1234.5p simulated by multiplying 0.5 by 2469.
      // Easier: 12.345 × 100 = 1234.5p → 1235p.
      const m = Money.fromPaise(2469).multiply(0.5);
      expect(m.amountInPaise).toBe(1235);
    });

    it('preserves sign on multiplication', () => {
      const debit = Money.fromPaise(-500);
      expect(debit.multiply(2).amountInPaise).toBe(-1000);
    });

    it('rejects NaN factor', () => {
      const m = Money.fromPaise(100);
      expect(() => m.multiply(NaN)).toThrow(RangeError);
    });
  });

  describe('roundHalfUp (static)', () => {
    it('handles positive halves away from zero', () => {
      expect(Money.roundHalfUp(0.5)).toBe(1);
      expect(Money.roundHalfUp(1.5)).toBe(2);
      expect(Money.roundHalfUp(2.5)).toBe(3);
    });

    it('handles negative halves away from zero (the JS Math.round trap)', () => {
      expect(Money.roundHalfUp(-0.5)).toBe(-1);
      expect(Money.roundHalfUp(-1.5)).toBe(-2);
      expect(Money.roundHalfUp(-2.5)).toBe(-3);
    });

    it('rejects NaN', () => {
      expect(() => Money.roundHalfUp(NaN)).toThrow(RangeError);
    });
  });

  // ─── Comparisons ──────────────────────────────────────────────────

  describe('equals / lessThan / greaterThan', () => {
    it('equals: same currency + paise', () => {
      expect(Money.fromPaise(100).equals(Money.fromPaise(100))).toBe(true);
      expect(Money.fromPaise(100).equals(Money.fromPaise(101))).toBe(false);
    });

    it('lessThan / greaterThan compare paise within the same currency', () => {
      const a = Money.fromPaise(100);
      const b = Money.fromPaise(200);
      expect(a.lessThan(b)).toBe(true);
      expect(b.greaterThan(a)).toBe(true);
      expect(a.greaterThan(b)).toBe(false);
    });

    it('lessThan / greaterThan reject different currencies', () => {
      const inr = Money.fromPaise(100);
      const fakeUsd = { amountInPaise: 100, currency: 'USD' } as unknown as Money;
      expect(() => inr.lessThan(fakeUsd)).toThrow(TypeError);
    });
  });

  // ─── Conversion ───────────────────────────────────────────────────

  describe('toRupees / displayString / toJSON', () => {
    it('toRupees returns the decimal rupee amount', () => {
      expect(Money.fromPaise(1234).toRupees()).toBe(12.34);
      expect(Money.fromPaise(100).toRupees()).toBe(1);
    });

    it('displayString uses en-IN locale by default', () => {
      // Intl.NumberFormat may use a non-breaking space or a regular
      // space depending on Node version — accept both.
      const got = Money.fromPaise(123456).displayString();
      expect(got).toMatch(/^₹\s?1,234\.56$/);
    });

    it('toJSON returns the wire format with all three fields', () => {
      const m = Money.fromPaise(99900);
      const j = m.toJSON();
      expect(j.amountInPaise).toBe(99900);
      expect(j.currency).toBe('INR');
      expect(typeof j.displayInr).toBe('string');
      expect(j.displayInr).toMatch(/999\.00/);
    });

    it('JSON.stringify uses toJSON automatically', () => {
      const wrapped = { amount: Money.fromPaise(50000) };
      const serialized = JSON.parse(JSON.stringify(wrapped));
      expect(serialized.amount.amountInPaise).toBe(50000);
      expect(serialized.amount.currency).toBe('INR');
      expect(typeof serialized.amount.displayInr).toBe('string');
    });
  });

  // ─── Sign helpers ─────────────────────────────────────────────────

  describe('sign predicates', () => {
    it.each([
      [0, true, false, false],
      [1, false, true, false],
      [-1, false, false, true],
    ])(
      'paise=%i → isZero=%s isPositive=%s isNegative=%s',
      (paise, zero, positive, negative) => {
        const m = Money.fromPaise(paise);
        expect(m.isZero()).toBe(zero);
        expect(m.isPositive()).toBe(positive);
        expect(m.isNegative()).toBe(negative);
      },
    );
  });
});
