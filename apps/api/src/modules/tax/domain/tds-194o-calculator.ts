// Phase 27 — Section 194-O Income-Tax TDS pure calculation.
//
// CBDT Section 194-O (introduced via Finance Act 2020, in force from
// 2020-10-01) requires the marketplace operator to deduct income-tax
// at source on the GROSS sale value (incl. GST) facilitated for an
// e-commerce participant.
//
// Rate (Section 194-O + Section 206AA penalty rate):
//   - 100 bps (1.0%) when the seller has furnished a valid PAN
//   - 500 bps (5.0%) when the seller has NOT furnished a valid PAN
//
// Exemption (Section 194-O sub-section 2):
//   - Individual / HUF sellers whose aggregate FY gross does not
//     exceed ₹5,00,000 AND who have furnished PAN/Aadhaar are exempt
//   - Modelled via `is194OExempt` admin attestation on Seller —
//     this calculator just consumes the boolean.
//
// Inputs are pre-aggregated by the service layer; this module only
// does the arithmetic. Half-away-from-zero rounding per the rest of
// the money codebase (ADR-007).

export const TDS_194O_RATE_WITH_PAN_BPS = 100;     // 1%
export const TDS_194O_RATE_WITHOUT_PAN_BPS = 500;  // 5% (Section 206AA)

export interface Tds194OInput {
  /** Gross sale value in paise — INCLUDES GST (distinct from TCS). */
  grossSaleInPaise: bigint;
  /** True when the seller has furnished a verified PAN. */
  hasVerifiedPan: boolean;
  /** True when admin has attested sub-threshold exemption. Overrides
   *  the rate selection — returns zero TDS regardless of grossSale. */
  isExempt?: boolean;
  /** Optional explicit rate override (admin-set or future regulatory
   *  change). When provided, overrides the with/without-PAN selection
   *  but NOT the isExempt branch. */
  rateBpsOverride?: number;
}

export interface Tds194OBreakdown {
  tdsInPaise: bigint;
  rateBps: number;
  /** True when the result is zero because of the exemption flag
   *  (vs zero because gross was zero). Used by callers to decide
   *  whether to persist a "zero" ledger row at all. */
  exempted: boolean;
}

/**
 * Compute the TDS amount for a given gross sale. Returns zero when
 * the seller is exempt or the gross is zero/negative.
 */
export function computeTds194O(input: Tds194OInput): Tds194OBreakdown {
  if (input.isExempt) {
    return { tdsInPaise: 0n, rateBps: 0, exempted: true };
  }
  if (input.grossSaleInPaise <= 0n) {
    return {
      tdsInPaise: 0n,
      rateBps: rateFor(input),
      exempted: false,
    };
  }

  const rateBps = rateFor(input);
  if (rateBps < 0 || rateBps > 10_000) {
    throw new Error(`TDS rate out of range: ${rateBps} bps`);
  }
  const tdsInPaise = mulBpsRoundHalfAway(input.grossSaleInPaise, rateBps);
  return { tdsInPaise, rateBps, exempted: false };
}

/**
 * Clamp net sale at zero and emit the carry-forward when prior-period
 * refunds exceed current-period gross. The caller persists
 * `carryForward` on the current row and feeds it as a debit into
 * the next period's `refundReversalInPaise`.
 */
export function clampNetSaleWithCarryForward(input: {
  grossSaleInPaise: bigint;
  refundReversalInPaise: bigint;
  priorCarryForwardInPaise?: bigint;
}): {
  netSaleInPaise: bigint;
  carryForwardInPaise: bigint;
} {
  const prior = input.priorCarryForwardInPaise ?? 0n;
  const raw =
    input.grossSaleInPaise -
    input.refundReversalInPaise -
    prior;
  if (raw < 0n) {
    return { netSaleInPaise: 0n, carryForwardInPaise: -raw };
  }
  return { netSaleInPaise: raw, carryForwardInPaise: 0n };
}

/**
 * Resolve a date to its Form-26Q filing period in Indian-FY quarters.
 *   Apr-Jun  → "YYYY-Q1"   (Q1 of FY starting YYYY)
 *   Jul-Sep  → "YYYY-Q2"
 *   Oct-Dec  → "YYYY-Q3"
 *   Jan-Mar  → "(YYYY-1)-Q4"  (FY started the previous Apr)
 *
 * Examples:
 *   2026-04-01 IST → "2026-Q1"
 *   2026-10-01 IST → "2026-Q3"
 *   2027-03-31 IST → "2026-Q4"  (still FY 2026-27)
 *   2027-04-01 IST → "2027-Q1"
 */
export function filingPeriodOf(date: Date): string {
  const utcMs = date.getTime();
  const istMs = utcMs + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const m = ist.getUTCMonth(); // 0 = Jan
  const y = ist.getUTCFullYear();

  // Indian FY runs Apr-Mar. Quarter map:
  //   Apr(3) May(4) Jun(5)   → Q1 of FY starting in `y`
  //   Jul(6) Aug(7) Sep(8)   → Q2
  //   Oct(9) Nov(10) Dec(11) → Q3
  //   Jan(0) Feb(1) Mar(2)   → Q4 of FY starting in `y-1`
  let fyStartYear: number;
  let q: number;
  if (m >= 3 && m <= 5) {
    fyStartYear = y;
    q = 1;
  } else if (m >= 6 && m <= 8) {
    fyStartYear = y;
    q = 2;
  } else if (m >= 9 && m <= 11) {
    fyStartYear = y;
    q = 3;
  } else {
    fyStartYear = y - 1;
    q = 4;
  }
  return `${fyStartYear}-Q${q}`;
}

// ───────────────────────────────────────────────────────────────

function rateFor(input: Tds194OInput): number {
  if (input.rateBpsOverride !== undefined) {
    return input.rateBpsOverride;
  }
  return input.hasVerifiedPan
    ? TDS_194O_RATE_WITH_PAN_BPS
    : TDS_194O_RATE_WITHOUT_PAN_BPS;
}

/**
 * `value * bps / 10000` with half-away-from-zero rounding. Pure
 * BigInt — never converts to Number, so no IEEE-754 drift even on
 * crore-scale values. Same shape as `tcs-calculator.ts` for parity.
 */
function mulBpsRoundHalfAway(value: bigint, bps: number): bigint {
  if (bps === 0 || value === 0n) return 0n;
  const num = value * BigInt(bps);
  const denom = 10_000n;
  const quotient = num / denom;
  const remainder = num % denom;
  const absRem = remainder < 0n ? -remainder : remainder;
  if (absRem * 2n >= denom) {
    return num >= 0n ? quotient + 1n : quotient - 1n;
  }
  return quotient;
}
