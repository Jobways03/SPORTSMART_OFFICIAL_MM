import 'reflect-metadata';
import { RestockingFeeCalculator } from '../../src/modules/returns/application/services/restocking-fee.calculator';

/**
 * Phase 5 (PR 5.4) — RestockingFeeCalculator.
 *
 * Pin every branch:
 *   - bps=0 (off): no fee, never.
 *   - buyer-fault reasons: fee applied when bps > 0.
 *   - merchant-fault reasons: never charged regardless of bps.
 *   - Floor rounding: customer never pays a paise more than the math.
 *   - Fee clamps at the gross amount (defensive — schema also caps bps).
 */
describe('RestockingFeeCalculator', () => {
  function make(bps: number) {
    const env = { getNumber: () => bps } as any;
    return new RestockingFeeCalculator(env);
  }

  it('charges 0 when RETURN_RESTOCKING_FEE_BPS=0 (default off)', () => {
    const calc = make(0);
    const out = calc.compute({
      grossRefundInPaise: 100_000,
      reason: 'CHANGED_MIND',
    });
    expect(out.feeApplied).toBe(false);
    expect(out.feeInPaise).toBe(0);
    expect(out.netRefundInPaise).toBe(100_000);
  });

  it('charges 10% on CHANGED_MIND when bps=1000', () => {
    const calc = make(1000);
    const out = calc.compute({
      grossRefundInPaise: 100_000,
      reason: 'CHANGED_MIND',
    });
    expect(out.feeApplied).toBe(true);
    expect(out.feeInPaise).toBe(10_000);
    expect(out.netRefundInPaise).toBe(90_000);
  });

  it('charges fee on SIZE_FIT_ISSUE (buyer fault)', () => {
    const calc = make(500);
    const out = calc.compute({
      grossRefundInPaise: 50_000,
      reason: 'SIZE_FIT_ISSUE',
    });
    expect(out.feeInPaise).toBe(2_500);
    expect(out.netRefundInPaise).toBe(47_500);
  });

  it('does NOT charge fee on DEFECTIVE (merchant fault)', () => {
    const calc = make(1000);
    const out = calc.compute({
      grossRefundInPaise: 100_000,
      reason: 'DEFECTIVE',
    });
    expect(out.feeApplied).toBe(false);
    expect(out.feeInPaise).toBe(0);
    expect(out.netRefundInPaise).toBe(100_000);
  });

  it('does NOT charge fee on WRONG_ITEM / NOT_AS_DESCRIBED / DAMAGED_IN_TRANSIT', () => {
    const calc = make(1500);
    for (const reason of [
      'WRONG_ITEM',
      'NOT_AS_DESCRIBED',
      'DAMAGED_IN_TRANSIT',
    ]) {
      const out = calc.compute({ grossRefundInPaise: 75_000, reason });
      expect(out.feeApplied).toBe(false);
      expect(out.netRefundInPaise).toBe(75_000);
    }
  });

  it('rounds DOWN — never overcharges the customer', () => {
    const calc = make(1234); // 12.34%
    // 12.34% of 999 paise = 123.2766 → floor → 123 paise.
    const out = calc.compute({
      grossRefundInPaise: 999,
      reason: 'CHANGED_MIND',
    });
    expect(out.feeInPaise).toBe(123);
    expect(out.netRefundInPaise).toBe(876);
  });

  it('clamps fee at gross (cannot drive net negative)', () => {
    // bps=10000 (100%) is the schema max; just below it 9999 still
    // gives a fee just below 100%. We use 10000 here to exercise the
    // clamp branch defensively.
    const calc = make(10_000);
    const out = calc.compute({
      grossRefundInPaise: 50_000,
      reason: 'CHANGED_MIND',
    });
    expect(out.feeInPaise).toBe(50_000);
    expect(out.netRefundInPaise).toBe(0);
  });
});
