// Phase 9 GST — invoice round-off helper.
//
// Indian invoice convention: total payable is rounded to the nearest
// rupee, with the small (±49 paise) difference shown as a "Round
// off" line. This keeps the customer-facing total a whole-rupee
// amount even though all internal math is paise-exact.
//
// Algorithm (half-away-from-zero):
//   rawAmountInPaise = 1234567   ( ₹12,345.67 )
//   nearestRupee     = 12346     ( ₹12,346 )
//   roundedInPaise   = 1234600
//   roundOffInPaise  = +33       ( amount UP — customer pays ₹0.33 extra )
//
//   rawAmountInPaise = 1234534   ( ₹12,345.34 )
//   nearestRupee     = 12345
//   roundedInPaise   = 1234500
//   roundOffInPaise  = -34       ( amount DOWN — customer pays ₹0.34 less )
//
// The roundOff value is signed: positive means customer pays more
// than the raw sum, negative means less. The line on the invoice
// shows the absolute value with the appropriate sign indicator.

export interface RoundOffResult {
  rawAmountInPaise: bigint;
  roundedAmountInPaise: bigint;
  roundOffInPaise: bigint;        // signed; can be negative
}

/**
 * Compute the round-off line for an invoice total.
 * Pure function. Always rounds half away from zero (matches ADR-004
 * Money rounding rule).
 */
export function computeInvoiceRoundOff(rawAmountInPaise: bigint): RoundOffResult {
  // Half-away-from-zero on the paise part. For 50 paise exactly:
  //   positive → rounds up
  //   negative → rounds down (more negative)
  // For typical invoice totals this branch is irrelevant (positive),
  // but for credit-note negatives it matters.
  const paiseRemainder = rawAmountInPaise % 100n;
  const sign = rawAmountInPaise >= 0n ? 1n : -1n;
  const absRemainder = paiseRemainder < 0n ? -paiseRemainder : paiseRemainder;

  let roundedAmountInPaise: bigint;
  if (absRemainder >= 50n) {
    // Round away from zero
    roundedAmountInPaise = rawAmountInPaise + sign * (100n - absRemainder);
  } else {
    // Round towards zero
    roundedAmountInPaise = rawAmountInPaise - paiseRemainder;
  }
  const roundOffInPaise = roundedAmountInPaise - rawAmountInPaise;
  return { rawAmountInPaise, roundedAmountInPaise, roundOffInPaise };
}
