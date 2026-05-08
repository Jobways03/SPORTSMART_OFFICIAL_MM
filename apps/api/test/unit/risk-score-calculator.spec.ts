import 'reflect-metadata';
import { RiskScoreCalculator } from '../../src/core/risk/risk-score.calculator';

/**
 * Phase 6 (PR 6.3) — RiskScoreCalculator.
 *
 * Pin every weight branch and the tier thresholds. The calculator is
 * the single point of truth for scoring; review changes to it like
 * code that moves money — because it does, indirectly, by routing
 * cases away from auto-processing.
 */
describe('RiskScoreCalculator', () => {
  const calc = new RiskScoreCalculator();

  const baseSignals = {
    kind: 'return' as const,
    amountInPaise: 100_000, // ₹1,000
    customerFlaggedForAbuse: false,
    hoursSinceOrder: 100, // ~4 days
    refundMethod: 'ORIGINAL_PAYMENT' as const,
    reasonCategory: 'DEFECTIVE' as const,
  };

  it('low-amount, clean customer, defective: scores LOW (=0)', () => {
    const out = calc.compute({ ...baseSignals, amountInPaise: 50_000 });
    expect(out.score).toBe(0);
    expect(out.tier).toBe('LOW');
  });

  it('amount tier weights: <₹2k=0, <₹10k=10, <₹50k=25, >₹50k=40', () => {
    expect(
      calc.compute({ ...baseSignals, amountInPaise: 199_999 }).signals.amount,
    ).toBe(0);
    expect(
      calc.compute({ ...baseSignals, amountInPaise: 200_000 }).signals.amount,
    ).toBe(10);
    expect(
      calc.compute({ ...baseSignals, amountInPaise: 1_000_000 }).signals
        .amount,
    ).toBe(25);
    expect(
      calc.compute({ ...baseSignals, amountInPaise: 5_000_001 }).signals
        .amount,
    ).toBe(40);
  });

  it('abuser flag adds 30 to the score', () => {
    const clean = calc.compute({
      ...baseSignals,
      amountInPaise: 1_000_000,
      customerFlaggedForAbuse: false,
    });
    const abuser = calc.compute({
      ...baseSignals,
      amountInPaise: 1_000_000,
      customerFlaggedForAbuse: true,
    });
    expect(abuser.score - clean.score).toBe(30);
  });

  it('recency: <24h adds 10, >30d subtracts 5', () => {
    const recent = calc.compute({ ...baseSignals, hoursSinceOrder: 12 });
    const old = calc.compute({ ...baseSignals, hoursSinceOrder: 24 * 31 });
    expect(recent.signals.recency).toBe(10);
    expect(old.signals.recency).toBe(-5);
  });

  it('MANUAL refund method adds 15; COUPON subtracts 5', () => {
    expect(
      calc.compute({ ...baseSignals, refundMethod: 'MANUAL' }).signals
        .refundMethod,
    ).toBe(15);
    expect(
      calc.compute({ ...baseSignals, refundMethod: 'COUPON' }).signals
        .refundMethod,
    ).toBe(-5);
    expect(
      calc.compute({ ...baseSignals, refundMethod: 'ORIGINAL_PAYMENT' })
        .signals.refundMethod,
    ).toBe(0);
  });

  it('CHANGED_MIND adds 10; OTHER adds 5; DEFECTIVE adds 0', () => {
    expect(
      calc.compute({ ...baseSignals, reasonCategory: 'CHANGED_MIND' }).signals
        .reasonCategory,
    ).toBe(10);
    expect(
      calc.compute({ ...baseSignals, reasonCategory: 'OTHER' }).signals
        .reasonCategory,
    ).toBe(5);
    expect(
      calc.compute({ ...baseSignals, reasonCategory: 'DEFECTIVE' }).signals
        .reasonCategory,
    ).toBe(0);
  });

  it('score is clamped at 100', () => {
    // 40 (amount) + 30 (abuser) + 10 (recency) + 15 (manual) + 10 (changed mind)
    // = 105 raw → clamped to 100.
    const out = calc.compute({
      kind: 'return',
      amountInPaise: 10_000_000,
      customerFlaggedForAbuse: true,
      hoursSinceOrder: 1,
      refundMethod: 'MANUAL',
      reasonCategory: 'CHANGED_MIND',
    });
    expect(out.score).toBe(100);
    expect(out.tier).toBe('HIGH');
    expect(out.signals.rawScoreBeforeClamp).toBeGreaterThan(100);
  });

  it('score is floored at 0 (negative recency + COUPON cannot go below)', () => {
    const out = calc.compute({
      kind: 'return',
      amountInPaise: 50_000, // 0
      customerFlaggedForAbuse: false, // 0
      hoursSinceOrder: 24 * 90, // -5
      refundMethod: 'COUPON', // -5
      reasonCategory: 'DEFECTIVE', // 0
    });
    expect(out.score).toBe(0);
    expect(out.tier).toBe('LOW');
  });

  it('tier thresholds: 0-39 LOW, 40-69 MEDIUM, 70-100 HIGH', () => {
    expect(
      calc.compute({
        ...baseSignals,
        amountInPaise: 1_000_000,
        customerFlaggedForAbuse: true,
      }).tier,
    ).toBe('MEDIUM'); // 25 + 30 = 55

    expect(
      calc.compute({
        ...baseSignals,
        amountInPaise: 5_000_001, // 40
        customerFlaggedForAbuse: true, // 30
        refundMethod: 'MANUAL', // 15
      }).tier,
    ).toBe('HIGH'); // 85
  });

  it('rationale fields are present in signals for explainability', () => {
    const out = calc.compute(baseSignals);
    expect(out.signals).toMatchObject({
      amount: expect.any(Number),
      abuser: expect.any(Number),
      recency: expect.any(Number),
      refundMethod: expect.any(Number),
      reasonCategory: expect.any(Number),
      inputs: {
        kind: 'return',
        amountInPaise: 100_000,
        customerFlaggedForAbuse: false,
      },
    });
  });
});
