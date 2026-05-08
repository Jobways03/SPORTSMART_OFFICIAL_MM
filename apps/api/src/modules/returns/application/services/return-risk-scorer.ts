/**
 * Phase 13 (P1.11) — pure-function rule-based risk scorer for returns.
 *
 * Each dimension is a pure function from a small `RiskSnapshot` to
 * `{ score: number, flag?: string }`. The aggregator sums the
 * dimension scores and clamps to 0-100. Pure-function design lets
 * unit tests cover every branch without spinning up Prisma — and
 * lets the service-side wrapper (return-risk-scorer.service.ts)
 * stay a thin orchestrator that only worries about data fetches.
 *
 * Risk score is intentionally **rule-based** (not ML). Rationale:
 *   - explainable: admin sees the exact flags that fired
 *   - tunable: each dimension's weight is a constant we can adjust
 *     without retraining a model
 *   - fast: zero DB calls inside the scorer; one DB call per
 *     dimension at the orchestrator level
 *
 * Score → routing semantics (applied by the auto-approval service):
 *    0-29  LOW    — auto-approve (existing path)
 *    30-59 MEDIUM — auto-approve only if all reasons are trusted
 *    60-100 HIGH  — manual review (route to admin queue)
 *
 * Per spec: "Risk score should route to manual review, not auto-reject."
 * No dimension here triggers auto-rejection; the worst outcome is the
 * return sits in REQUESTED until an admin processes it.
 */

export type RiskFlag =
  | 'CUSTOMER_ABUSE'
  | 'HIGH_RECENT_RETURN_COUNT'
  | 'HIGH_VALUE_WEAK_EVIDENCE'
  | 'HIGH_VALUE'
  | 'MISSING_ITEM_CLAIM'
  | 'CHARGEBACK_HISTORY'
  // Phase 13 completion — seller-side and courier-side patterns
  // (cross-customer signals; require aggregate queries at intake).
  | 'SELLER_HIGH_WRONG_ITEM_RATE'
  | 'COURIER_DAMAGE_HOTSPOT';

export interface RiskSnapshot {
  /** Total return value in paise. */
  totalValueInPaise: number;
  /** Count of evidence files attached at intake. */
  evidenceCount: number;
  /** Reason categories on the return items. */
  reasonCategories: string[];
  /**
   * Rolling-window history snapshot. Filled in by the service layer
   * from CustomerAbuseCounter + recent-orders count + a chargeback
   * lookup. Pure scorer doesn't fetch anything.
   */
  customer: {
    flaggedForAbuse: boolean;
    recentReturnCount: number; // last 30 days, e.g. 3+ flips a flag
    chargebackCountLifetime: number;
  };
  /**
   * Phase 13 completion — seller-side aggregate. The orchestrator
   * computes (WRONG_ITEM returns / total returns) over the last 90
   * days for the seller fulfilling this return. Above the threshold
   * the seller has a pattern of mis-shipping; treat the new claim
   * as more credible (less likely to be customer fraud).
   */
  seller?: {
    wrongItemRateBps: number; // basis points, 0-10000 (50 = 0.50%)
    totalReturnsInWindow: number;
  };
  /**
   * Phase 13 completion — courier-side aggregate. The orchestrator
   * computes the count of DAMAGED_IN_TRANSIT returns the *same
   * courier* has accumulated in the last 30 days. A handful is
   * normal; a hotspot signals route / handling problems.
   */
  courier?: {
    damageClaimsInWindow: number;
    courierName: string | null;
  };
}

export interface RiskAssessment {
  score: number; // clamped 0-100
  flags: RiskFlag[];
  level: 'LOW' | 'MEDIUM' | 'HIGH';
}

/** Threshold above which a return value alone counts as "high value". */
const HIGH_VALUE_PAISE = 1_000_000; // ₹10,000
/** Threshold for the no-evidence high-value sub-rule. */
const HIGH_VALUE_NO_EVIDENCE_PAISE = 500_000; // ₹5,000
/** Recent-return count that flips the customer-history flag. */
const RECENT_RETURN_THRESHOLD = 3;

// ─── Dimension functions (pure) ────────────────────────────────────

export function scoreCustomerAbuse(s: RiskSnapshot): {
  score: number;
  flag: RiskFlag | null;
} {
  // Pre-computed by CustomerAbuseCounterService — heaviest weight
  // because it represents an explicit policy hit, not just a heuristic.
  return s.customer.flaggedForAbuse
    ? { score: 40, flag: 'CUSTOMER_ABUSE' }
    : { score: 0, flag: null };
}

export function scoreRecentReturns(s: RiskSnapshot): {
  score: number;
  flag: RiskFlag | null;
} {
  if (s.customer.recentReturnCount >= RECENT_RETURN_THRESHOLD) {
    // Linear ramp: 3 returns = 15 points, 6+ returns = 30 points.
    const overage = s.customer.recentReturnCount - RECENT_RETURN_THRESHOLD;
    const score = Math.min(30, 15 + overage * 5);
    return { score, flag: 'HIGH_RECENT_RETURN_COUNT' };
  }
  return { score: 0, flag: null };
}

export function scoreHighValueWeakEvidence(s: RiskSnapshot): {
  score: number;
  flag: RiskFlag | null;
} {
  // Two interlocking rules:
  //   - high value alone adds a small risk weight
  //   - high value + zero evidence adds a much larger weight (the
  //     classic abuse pattern — ₹15,000 claim with no photo)
  if (
    s.totalValueInPaise >= HIGH_VALUE_NO_EVIDENCE_PAISE &&
    s.evidenceCount === 0
  ) {
    return { score: 25, flag: 'HIGH_VALUE_WEAK_EVIDENCE' };
  }
  if (s.totalValueInPaise >= HIGH_VALUE_PAISE) {
    return { score: 10, flag: 'HIGH_VALUE' };
  }
  return { score: 0, flag: null };
}

export function scoreMissingItemClaim(s: RiskSnapshot): {
  score: number;
  flag: RiskFlag | null;
} {
  // "Missing item" is the highest-fraud reason category in the
  // industry — package was delivered but customer claims item is
  // not in box. We don't have a dedicated MISSING_ITEM enum value
  // today; treat WRONG_ITEM with zero evidence as the same shape
  // (most "I never got it" claims come in as wrong-item).
  if (
    s.reasonCategories.includes('WRONG_ITEM') &&
    s.evidenceCount === 0
  ) {
    return { score: 15, flag: 'MISSING_ITEM_CLAIM' };
  }
  return { score: 0, flag: null };
}

export function scoreChargebackHistory(s: RiskSnapshot): {
  score: number;
  flag: RiskFlag | null;
} {
  // Lifetime > 0 is enough — chargebacks are rare and disproportionately
  // signal a fraud-prone account.
  if (s.customer.chargebackCountLifetime > 0) {
    return { score: 25, flag: 'CHARGEBACK_HISTORY' };
  }
  return { score: 0, flag: null };
}

/**
 * Phase 13 completion — seller-side wrong-item-rate signal.
 *
 * Reduces the customer-side risk score when the seller has a
 * documented pattern of shipping wrong items. The 'risk' here is on
 * the SELLER, not the customer — so we *subtract* from the score
 * (clamped to 0). High wrong-item-rate sellers should NOT push their
 * customer's claim into auto-rejection territory; if anything we
 * trust the customer more.
 *
 * Threshold: 10% wrong-item rate (1000 bps) over the last window
 * with at least 5 returns to filter noise.
 */
export function scoreSellerWrongItemRate(s: RiskSnapshot): {
  score: number;
  flag: RiskFlag | null;
} {
  if (!s.seller) return { score: 0, flag: null };
  const minVolume = 5;
  const wrongItemRateThresholdBps = 1000; // 10%
  if (
    s.seller.totalReturnsInWindow < minVolume ||
    s.seller.wrongItemRateBps < wrongItemRateThresholdBps
  ) {
    return { score: 0, flag: null };
  }
  // Negative score: the seller has a track record so we reduce
  // suspicion of the customer. -15 is conservative — even a
  // pattern-prone seller doesn't fully exonerate every claim.
  return { score: -15, flag: 'SELLER_HIGH_WRONG_ITEM_RATE' };
}

/**
 * Phase 13 completion — courier damage-claim hotspot signal.
 *
 * If the courier on this return has accumulated a flurry of
 * DAMAGED_IN_TRANSIT claims recently, the customer's "damaged"
 * claim is more credible. Same as scoreSellerWrongItemRate, this
 * SHIFTS suspicion toward LOGISTICS attribution — we subtract from
 * the customer-fraud score. Threshold: 5+ damage claims in 30 days
 * for the same courier (configurable via env later).
 */
export function scoreCourierDamageHotspot(s: RiskSnapshot): {
  score: number;
  flag: RiskFlag | null;
} {
  if (!s.courier || !s.courier.courierName) {
    return { score: 0, flag: null };
  }
  const damageHotspotThreshold = 5;
  if (s.courier.damageClaimsInWindow < damageHotspotThreshold) {
    return { score: 0, flag: null };
  }
  return { score: -10, flag: 'COURIER_DAMAGE_HOTSPOT' };
}

// ─── Aggregator ──────────────────────────────────────────────────

const DIMENSIONS = [
  scoreCustomerAbuse,
  scoreRecentReturns,
  scoreHighValueWeakEvidence,
  scoreMissingItemClaim,
  scoreChargebackHistory,
  scoreSellerWrongItemRate,
  scoreCourierDamageHotspot,
];

export function assessReturnRisk(s: RiskSnapshot): RiskAssessment {
  let score = 0;
  const flags: RiskFlag[] = [];
  for (const dim of DIMENSIONS) {
    const r = dim(s);
    score += r.score;
    if (r.flag) flags.push(r.flag);
  }
  const clamped = Math.max(0, Math.min(100, score));
  let level: RiskAssessment['level'] = 'LOW';
  if (clamped >= 60) level = 'HIGH';
  else if (clamped >= 30) level = 'MEDIUM';
  return { score: clamped, flags, level };
}
