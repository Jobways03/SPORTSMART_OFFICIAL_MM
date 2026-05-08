import 'reflect-metadata';
import { MoneyDualWriteHelper } from '../../src/core/money/money-dual-write.helper';

/**
 * Unit tests for MoneyDualWriteHelper (PR 1.4).
 *
 * The helper must:
 *   - No-op when MONEY_DUAL_WRITE_ENABLED is false (return input unchanged)
 *   - Compute paise siblings for every Decimal money field on registered
 *     models, using ROUND_HALF_AWAY_FROM_ZERO consistent with Money VO
 *   - Skip fields not present on the input (don't fabricate values)
 *   - Pass through `null` to the paise sibling (Prisma "clear column"
 *     semantics)
 *   - Refuse to mutate the input object (immutability)
 *   - Handle Prisma.Decimal-like inputs via duck-typed .toNumber()
 *   - Handle createMany row arrays via applyPaiseMany
 */
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
    it('computes the paise sibling for a Decimal field', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise('return', { refundAmount: 12.34 });
      expect(out).toEqual({
        refundAmount: 12.34,
        refundAmountInPaise: 1234n,
      });
    });

    it('handles a Prisma.Decimal-like value via toNumber()', () => {
      const helper = buildHelper({ enabled: true });
      const fakeDecimal = { toNumber: () => 12.34 };
      const out = helper.applyPaise<Record<string, unknown>>('return', {
        refundAmount: fakeDecimal,
      });
      expect(out.refundAmountInPaise).toBe(1234n);
    });

    it('handles a string value (Prisma sometimes serializes Decimal as string)', () => {
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
      const input = { refundAmount: 12.34 };
      helper.applyPaise('return', input);
      expect(input).toEqual({ refundAmount: 12.34 });
      expect((input as Record<string, unknown>).refundAmountInPaise).toBeUndefined();
    });

    it('handles a model with multiple money fields (orderItem)', () => {
      const helper = buildHelper({ enabled: true });
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

    it('handles negative amounts (refund debits)', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>(
        'settlementAdjustment',
        { amount: -50.5 },
      );
      expect(out.amountInPaise).toBe(-5050n);
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

  describe('rounding edge cases', () => {
    it('rounds half-paise away from zero (positive)', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>('return', {
        refundAmount: 0.005,
      });
      // 0.005 in IEEE 754 is actually 0.005000000000000000104...,
      // multiplied by 100 = 0.5000... → rounds up to 1.
      expect(out.refundAmountInPaise).toBe(1n);
    });

    it('rounds half-paise away from zero (negative)', () => {
      const helper = buildHelper({ enabled: true });
      const out = helper.applyPaise<Record<string, unknown>>(
        'settlementAdjustment',
        { amount: -0.005 },
      );
      // -0.5p must round to -1p, not 0 (the JS Math.round trap).
      expect(out.amountInPaise).toBe(-1n);
    });
  });
});
