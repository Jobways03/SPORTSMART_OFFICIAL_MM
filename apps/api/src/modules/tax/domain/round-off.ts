// Phase 9 GST — invoice round-off helper.
//
// HISTORY: this once rounded the invoice total to the nearest rupee (Indian
// invoice convention) and surfaced the ±49-paise difference as a "Round off"
// line. As of 2026-06 that policy was removed — invoices show the EXACT
// 2-decimal total so the printed grand total equals the exact paise amount the
// customer is actually charged. computeInvoiceRoundOff is now a pass-through
// that always returns roundOff = 0; see the function body for the rationale.
// The signed RoundOffResult shape is retained for callers and for historical
// TaxDocuments that persisted a non-zero round-off before this change.

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
  // Policy (2026-06, per user instruction "there should be no round off, it
  // should be in decimals"): invoices now carry the EXACT 2-decimal total.
  // The total equals taxable + GST + cess to the paise, which is also the
  // exact amount charged/collected at checkout (order totalAmountInPaise is
  // rounded to the nearest PAISE, never the nearest rupee) — so the invoice
  // now MATCHES what the customer paid instead of differing by up to ±49 paise.
  //
  // Kept as a single pass-through (rather than removing the function) so every
  // caller stays consistent in one edit: marketplace sub-order invoices
  // (D2C + retail), franchise POS invoices, credit notes, and the checkout tax
  // preview. roundOff is always 0, so the templates suppress the "Round Off"
  // row, and amount-in-words (derived from roundedAmountInPaise) renders the
  // exact paise, e.g. "Indian Rupees Eight Hundred Eighteen and Ten Paise Only".
  return {
    rawAmountInPaise,
    roundedAmountInPaise: rawAmountInPaise,
    roundOffInPaise: 0n,
  };
}
