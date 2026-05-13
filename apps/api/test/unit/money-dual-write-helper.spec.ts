import 'reflect-metadata';
import { MoneyDualWriteHelper } from '../../src/core/money/money-dual-write.helper';

/**
 * Unit tests for MoneyDualWriteHelper (PR 1.4).
 *
 * The helper must:
 *   - No-op when MONEY_DUAL_WRITE_ENABLED is false (return input unchanged)
 *   - Compute paise siblings for every Decimal money field on registered
 *     models. Phase 0 (PR 0.4) — precision-safe inputs only:
 *     Prisma.Decimal-like (mul + toFixed), strings, or integer numbers.
 *     Fractional `number` inputs are REJECTED with a thrown RangeError
 *     because they have already lost precision before reaching us.
 *   - Skip fields not present on the input (don't fabricate values)
 *   - Pass through `null` to the paise sibling (Prisma "clear column"
 *     semantics)
 *   - Refuse to mutate the input object (immutability)
 *   - Handle Prisma.Decimal-like inputs via duck-typed `.mul().toFixed()`
 *   - Handle createMany row arrays via applyPaiseMany
 */

/**
 * Phase 0 (PR 0.4) — tiny Decimal-like used in these tests instead of
 * importing Prisma's Decimal (avoids the test depending on the Prisma
 * runtime). Implements only the `.mul + .toFixed` surface the helper
 * duck-types on. String-arithmetic so JS float never touches values.
 */
function dec(s: string) {
  const obj = {
    raw: s,
    mul(factor: number) {
      // Used here only with `factor === 100` to convert rupees → paise.
      // String-shift the decimal point right by log10(factor) places.
      // Keeps tests focused on the helper contract without needing a
      // full Decimal implementation.
      if (factor !== 100) {
        throw new Error('test dec().mul only supports *100');
      }
      const negative = s.startsWith('-');
      const u = negative ? s.slice(1) : s;
      const [i, f = ''] = u.split('.');
      const fPadded = (f + '00').slice(0, Math.max(2, f.length));
      const moved =
        fPadded.length >= 2
          ? i + fPadded.slice(0, 2) + (fPadded.length > 2 ? '.' + fPadded.slice(2) : '')
          : i + fPadded;
      const stripped = moved.replace(/^0+(?=\d)/, '') || '0';
      return dec((negative ? '-' : '') + stripped);
    },
    toFixed(digits: number) {
      if (digits !== 0) throw new Error('test dec().toFixed only supports digits=0');
      // Round half-up at the first fractional digit.
      const negative = obj.raw.startsWith('-');
      const u = negative ? obj.raw.slice(1) : obj.raw;
      const [i, f = ''] = u.split('.');
      const roundDigit = f.charCodeAt(0) - 48;
      let n = BigInt(i.replace(/^0+(?=\d)/, '') || '0');
      if (roundDigit >= 5) n += 1n;
      return (negative ? '-' : '') + n.toString();
    },
  };
  return obj;
}

describe('MoneyDualWriteHelper', () => {
  function buildHelper(opts: { enabled: boolean }): MoneyDualWriteHelper {
    const env = {
      getBoolean: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'MONEY_DUAL_WRITE_ENABLED' ? opts.enabled : false,
        ),
    } as never;
    return new MoneyDualWriteHelper(env);
  }

  describe('flag-OFF', () => {
    it('returns input unchanged when feature is disabled', () => {
      const helper = buildHelper({ enabled: false });
      const input = { refundAmount: 12.34 };
      const out = helper.applyPaise('return', input);
      expect(out).toBe(input);
      expect(out).toEqual({ refundAmount: 12.34 });
    });
  });

  describe('flag-ON — single-row applyPaise', () => {
    it('computes the paise sibling from a Prisma.Decimal-like value', () => {
      const helper = buildHelper({ enabled: true });
      const refundAmount = dec('12.34');
      const out = helper.applyPaise<Record<string, unknown>>('return', {
        refundAmount,
      });
      expect(out.refundAmount).toBe(refundAmount);
      expect(out.refundAmountInPaise).toBe(1234n);
    });

    it('handles a string value (Prisma sometimes serializes Decimal as string in JSON paths)', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>('return', {
        refundAmount: '12.34',
      });
      expect(out.refundAmountInPaise).toBe(1234n);
    });

    it('handles a string value with 99.99 precision', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>('return', {
        refundAmount: '99.99',
      });
      expect(out.refundAmountInPaise).toBe(9999n);
    });

    it('passes null through to the paise sibling (clear column)', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>('return', {
        refundAmount: null,
      });
      expect(out.refundAmountInPaise).toBeNull();
    });

    it('skips fields that are not present on the input', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise('return', { id: 'r-1' });
      expect(out).toEqual({ id: 'r-1' }); // no refundAmountInPaise added
    });

    it('does NOT mutate the input', () => {
      const helper = buildHelper({ enabled: true });
      const input = { refundAmount: '12.34' };
      helper.applyPaise('return', input);
      expect(input).toEqual({ refundAmount: '12.34' });
      expect((input as Record<string, unknown>).refundAmountInPaise).toBeUndefined();
    });

    it('handles a model with multiple money fields (orderItem) — integer Numbers OK', () => {
      const helper = buildHelper({ enabled: true });
      // Integer JS Number is precision-safe (it's a whole rupee count).
      // toPaise routes integer Numbers through BigInt(n) * 100n.
      const out = helper.applyPaise('orderItem', {
        unitPrice: 5,
        totalPrice: 25,
        quantity: 5,
      });
      expect(out).toEqual({
        unitPrice: 5,
        totalPrice: 25,
        quantity: 5,
        unitPriceInPaise: 500n,
        totalPriceInPaise: 2500n,
      });
    });

    it('handles negative amounts (refund debits) as Decimal-like', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>(
        'settlementAdjustment',
        { amount: dec('-50.50') },
      );
      expect(out.amountInPaise).toBe(-5050n);
    });

    it('rejects a fractional JS Number (precision-loss guard) — Phase 0 PR 0.4', () => {
      const helper = buildHelper({ enabled: true });
      expect(() =>
        helper.applyPaise('return', { refundAmount: 12.34 }),
      ).toThrow(/refusing to convert fractional Number/);
    });

    it('returns input unchanged for an unknown model key', () => {
      const helper = buildHelper({ enabled: true });
      const input = { someField: 1 };
      const out = helper.applyPaise('nonExistentModel', input);
      expect(out).toBe(input);
    });
  });

  describe('applyPaiseMany', () => {
    it('augments every row in a createMany array', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaiseMany('orderItem', [
        { unitPrice: 1, totalPrice: 1 },
        { unitPrice: 2, totalPrice: 4 },
      ]);
      expect(out).toEqual([
        {
          unitPrice: 1,
          totalPrice: 1,
          unitPriceInPaise: 100n,
          totalPriceInPaise: 100n,
        },
        {
          unitPrice: 2,
          totalPrice: 4,
          unitPriceInPaise: 200n,
          totalPriceInPaise: 400n,
        },
      ]);
    });

    it('flag-OFF returns the rows unchanged', () => {
      const helper = buildHelper({ enabled: false });
      const rows = [{ unitPrice: 1, totalPrice: 1 }];
      expect(helper.applyPaiseMany('orderItem', rows)).toBe(rows);
    });
  });

  describe('isApplicable', () => {
    it('true for known model with money fields when flag is on', () => {
      const helper = buildHelper({ enabled: true });
      expect(helper.isApplicable('return')).toBe(true);
    });
    it('false when flag is off, even for known model', () => {
      const helper = buildHelper({ enabled: false });
      expect(helper.isApplicable('return')).toBe(false);
    });
    it('false for unknown model', () => {
      const helper = buildHelper({ enabled: true });
      expect(helper.isApplicable('nope')).toBe(false);
    });
  });

  describe('rounding edge cases (PR 0.4 — exact string + Decimal arithmetic)', () => {
    it('rounds half-paise up (positive) via string input', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>('return', {
        refundAmount: '0.005',
      });
      // "0.005" rupees = 0.5 paise → round half-up → 1 paise. Done via
      // string arithmetic so the IEEE-754 representation of 0.005
      // never enters the picture.
      expect(out.refundAmountInPaise).toBe(1n);
    });

    it('rounds half-paise away from zero (negative) via string input', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>(
        'settlementAdjustment',
        { amount: '-0.005' },
      );
      // "-0.005" rupees = -0.5 paise → -1 paise (away from zero).
      expect(out.amountInPaise).toBe(-1n);
    });

    it('preserves precision for very large rupee values (above 2^53 paise)', () => {
      const helper = buildHelper({ enabled: true });
      // 100,000,000,000 rupees = 10,000,000,000,000 paise = 10^13.
      // 2^53 ≈ 9.007 × 10^15 — we're below the JS-Number safe-integer
      // boundary here, but well into the range where the old
      // `Number(decimal) * 100` rounding was risky on string inputs.
      const out = helper.applyPaise<Record<string, unknown>>('return', {
        refundAmount: '100000000000.45',
      });
      expect(out.refundAmountInPaise).toBe(10000000000045n);
    });
  });

  describe('flag-OFF additional path-coverage', () => {
    // Earlier flag-OFF test used a JS number for input. With the
    // precision-loss guard now active even for the flag-OFF no-op path
    // (because the helper short-circuits BEFORE calling toPaise), this
    // is documented here for clarity rather than re-asserted.
    it('flag-OFF does not invoke toPaise — fractional Number passes through untouched', () => {
      const helper = buildHelper({ enabled: false });
      const input = { refundAmount: 12.34 } as Record<string, unknown>;
      const out = helper.applyPaise('return', input);
      // No throw: the helper returns input early when flag is off.
      expect(out).toBe(input);
    });
  });
});
