// Phase 16 GST — TCS (Section 52) pure calculation.
//
// Inputs are pre-aggregated by the service layer; this module only
// does the arithmetic. Keeping it pure makes the rate/split logic
// trivially testable without DB / Prisma mocks.
//
// Rate (CBIC notification 52/2018 onward): 100 bps total
//   Intra-state: 50 bps CGST + 50 bps SGST
//   Inter-state: 100 bps IGST
//
// Half-away-from-zero rounding — same convention as the rest of the
// money codebase (per ADR-007). Each TCS leg is rounded independently
// so the (cgst + sgst) sum equals the customer-side total computed by
// the GSTN portal to within ≤ 1 paise (CBIC accepts 1-paise rounding
// drift per leg).

export interface TcsInput {
  /** Intra-state portion of net taxable supply (paise). */
  intraStateTaxableInPaise: bigint;
  /** Inter-state portion of net taxable supply (paise). */
  interStateTaxableInPaise: bigint;
  /** Total rate in basis points (default 100 = 1%). */
  rateBps?: number;
}

export interface TcsBreakdown {
  cgstTcsInPaise: bigint;
  sgstTcsInPaise: bigint;
  igstTcsInPaise: bigint;
  totalTcsInPaise: bigint;
  rateBps: number;
}

/**
 * Compute the TCS breakdown for the given intra/inter-state split.
 * Negative inputs collapse to zero — TCS is never negative; the
 * carry-forward of negative net supply is handled by the caller.
 */
export function computeTcs(input: TcsInput): TcsBreakdown {
  const rateBps = input.rateBps ?? 100;
  if (rateBps < 0 || rateBps > 10_000) {
    throw new Error(`TCS rate out of range: ${rateBps} bps`);
  }
  const intra =
    input.intraStateTaxableInPaise < 0n ? 0n : input.intraStateTaxableInPaise;
  const inter =
    input.interStateTaxableInPaise < 0n ? 0n : input.interStateTaxableInPaise;

  // Split rate evenly across CGST/SGST for intra-state. Any odd
  // basis point (e.g. 101 → 50.5/50.5) is split as floor + ceil so
  // the two together exactly equal the total.
  const cgstBps = Math.floor(rateBps / 2);
  const sgstBps = rateBps - cgstBps;

  const cgst = mulBpsRoundHalfAway(intra, cgstBps);
  const sgst = mulBpsRoundHalfAway(intra, sgstBps);
  const igst = mulBpsRoundHalfAway(inter, rateBps);

  return {
    cgstTcsInPaise: cgst,
    sgstTcsInPaise: sgst,
    igstTcsInPaise: igst,
    totalTcsInPaise: cgst + sgst + igst,
    rateBps,
  };
}

/**
 * `value * bps / 10000` with half-away-from-zero rounding. Pure
 * BigInt — never converts to Number, so no IEEE-754 drift even on
 * crore-scale values.
 */
function mulBpsRoundHalfAway(value: bigint, bps: number): bigint {
  if (bps === 0 || value === 0n) return 0n;
  const num = value * BigInt(bps);
  const denom = 10_000n;
  const quotient = num / denom;
  const remainder = num % denom;
  // Half-away-from-zero: bump if |remainder * 2| >= denom.
  const absRem = remainder < 0n ? -remainder : remainder;
  if (absRem * 2n >= denom) {
    return num >= 0n ? quotient + 1n : quotient - 1n;
  }
  return quotient;
}

/**
 * Clamp net taxable supply at zero and emit the carry-forward
 * amount when negative. The caller persists `carryForward` on the
 * current row and feeds it as a debit into the next period's
 * `creditNoteReversalInPaise` aggregation.
 */
export function clampNetSupplyWithCarryForward(input: {
  grossTaxableInPaise: bigint;
  creditNoteReversalInPaise: bigint;
  priorCarryForwardInPaise?: bigint;
}): {
  netTaxableInPaise: bigint;
  carryForwardInPaise: bigint;
} {
  const prior = input.priorCarryForwardInPaise ?? 0n;
  const raw =
    input.grossTaxableInPaise -
    input.creditNoteReversalInPaise -
    prior;
  if (raw < 0n) {
    return { netTaxableInPaise: 0n, carryForwardInPaise: -raw };
  }
  return { netTaxableInPaise: raw, carryForwardInPaise: 0n };
}

/**
 * Resolve a date to its GSTR-8 filing period — `YYYY-MM` in IST.
 * (1 Apr 2026 → "2026-04"; 31 Mar 2027 23:59 IST → "2027-03".)
 */
export function filingPeriodOf(date: Date): string {
  const utcMs = date.getTime();
  const istMs = utcMs + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const m = ist.getUTCMonth() + 1;
  const y = ist.getUTCFullYear();
  return `${y}-${m.toString().padStart(2, '0')}`;
}
