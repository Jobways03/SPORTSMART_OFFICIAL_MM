import { Injectable } from '@nestjs/common';

/**
 * Phase 6 (PR 6.3) — Risk score calculator.
 *
 * Pure function over a set of signals → integer 0-100 + tier. NO DB
 * access, NO env reads, NO time-of-day branches — that keeps the
 * calculator unit-testable in isolation and keeps the score itself
 * deterministic for a given input.
 *
 * The signal weights are deliberately small integers so an experienced
 * reviewer can recognise the math at a glance ("oh, score 75 = abuser
 * (30) + high-amount (40) + manual refund method (5) = 75"). When we
 * tune the model in production, only the weights change — the public
 * shape stays stable.
 *
 * Tiers:
 *   - 0-39   LOW     — auto-process eligible
 *   - 40-69  MEDIUM  — visible flag, ops queue
 *   - 70-100 HIGH    — mandatory second-pair-of-eyes review
 *
 * Why no ML:
 *   - We don't have enough labelled abuse data yet (would be Phase 11+).
 *   - A linear model with hand-picked weights is auditable: a customer
 *     who scores HIGH and asks "why?" gets a list of signals, not
 *     "the model said so".
 */

export type ResourceKind = 'dispute' | 'return';

export interface RiskSignals {
  kind: ResourceKind;
  amountInPaise: number;
  /**
   * Customer carrying the soft-hold flag from PR 5.5 (90d return rate
   * threshold crossed).
   */
  customerFlaggedForAbuse: boolean;
  /**
   * Hours between the original order and the current case. Recent
   * (<24h) scores higher because "ordered, used, returning" is a
   * known fraud pattern.
   */
  hoursSinceOrder: number;
  /**
   * Refund method the case is heading toward. MANUAL means a human
   * has to confirm a UPI/bank transfer — more risk than ORIGINAL_PAYMENT.
   */
  refundMethod: 'ORIGINAL_PAYMENT' | 'WALLET' | 'UPI' | 'MANUAL' | 'COUPON';
  /**
   * Buyer's stated reason. Buyer-fault reasons score slightly higher
   * because there's no merchant-side error to corroborate the claim.
   */
  reasonCategory:
    | 'DEFECTIVE'
    | 'WRONG_ITEM'
    | 'NOT_AS_DESCRIBED'
    | 'DAMAGED_IN_TRANSIT'
    | 'CHANGED_MIND'
    | 'SIZE_FIT_ISSUE'
    | 'QUALITY_ISSUE'
    | 'OTHER';
}

export interface RiskScoreOutput {
  score: number;
  tier: 'LOW' | 'MEDIUM' | 'HIGH';
  /**
   * Each numeric weight applied + a nested `inputs` record echoing the
   * raw signals. Loose typing — readers should treat unknown keys as
   * informational. Stored as JSON in `risk_scores.signals`.
   */
  signals: {
    amount: number;
    abuser: number;
    recency: number;
    refundMethod: number;
    reasonCategory: number;
    rawScoreBeforeClamp: number;
    inputs: {
      kind: string;
      amountInPaise: number;
      customerFlaggedForAbuse: boolean;
      hoursSinceOrder: number;
      refundMethod: string;
      reasonCategory: string;
    };
  };
}

@Injectable()
export class RiskScoreCalculator {
  compute(input: RiskSignals): RiskScoreOutput {
    // Per-signal weight breakdown. Keys end with `Weight` so they
    // never collide with the raw input fields when we splat them into
    // the signals object below.
    const breakdown: Record<string, number> = {};

    // ── Amount tier ──────────────────────────────────────────────
    breakdown.amount = amountWeight(input.amountInPaise);

    // ── Customer abuse flag ─────────────────────────────────────
    breakdown.abuser = input.customerFlaggedForAbuse ? 30 : 0;

    // ── Recency ─────────────────────────────────────────────────
    if (input.hoursSinceOrder < 24) breakdown.recency = 10;
    else if (input.hoursSinceOrder > 24 * 30) breakdown.recency = -5;
    else breakdown.recency = 0;

    // ── Refund method ───────────────────────────────────────────
    if (input.refundMethod === 'MANUAL') breakdown.refundMethod = 15;
    else if (input.refundMethod === 'COUPON') breakdown.refundMethod = -5; // goodwill, lower risk to merchant
    else breakdown.refundMethod = 0;

    // ── Reason category ─────────────────────────────────────────
    if (input.reasonCategory === 'CHANGED_MIND')
      breakdown.reasonCategory = 10;
    else if (input.reasonCategory === 'OTHER') breakdown.reasonCategory = 5;
    else breakdown.reasonCategory = 0;

    const raw = Object.values(breakdown).reduce((s, n) => s + n, 0);
    const score = clamp(raw, 0, 100);

    let tier: 'LOW' | 'MEDIUM' | 'HIGH';
    if (score >= 70) tier = 'HIGH';
    else if (score >= 40) tier = 'MEDIUM';
    else tier = 'LOW';

    // Inputs are nested under `inputs` so the weight keys above
    // (refundMethod, reasonCategory) stay numbers in the signals object.
    return {
      score,
      tier,
      signals: {
        amount: breakdown.amount,
        abuser: breakdown.abuser,
        recency: breakdown.recency,
        refundMethod: breakdown.refundMethod,
        reasonCategory: breakdown.reasonCategory,
        rawScoreBeforeClamp: raw,
        inputs: {
          kind: input.kind,
          amountInPaise: input.amountInPaise,
          customerFlaggedForAbuse: input.customerFlaggedForAbuse,
          hoursSinceOrder: input.hoursSinceOrder,
          refundMethod: input.refundMethod,
          reasonCategory: input.reasonCategory,
        },
      },
    };
  }
}

function amountWeight(paise: number): number {
  if (paise < 200_000) return 0;
  if (paise < 1_000_000) return 10;
  if (paise < 5_000_000) return 25;
  return 40;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
