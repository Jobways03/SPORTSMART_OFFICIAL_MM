// Phase B (P0) — Per-line GST calculator.
//
// Indian GST rule: tax is calculated on the post-discount taxable
// value, not the gross. So this runs *after* discount allocation:
//
//   gross  → discount → taxable → cgst+sgst (intra) OR igst (inter)
//
// Rates in basis points (e.g. 1800 = 18%) so we can do BigInt-only
// arithmetic without floating point. Returns CGST+SGST splits for
// intra-state supply and IGST for inter-state — exactly one of the
// two is non-zero.
//
// For paise rounding we use deterministic floor on each component.
// Conservation: cgst + sgst + igst === totalTax. The caller writes
// one `OrderItemTaxSnapshot` row per result.

export interface GstInput {
  /** Pre-discount line gross. */
  grossInPaise: bigint;
  /** Allocated discount on this line (sum of OrderItemDiscount rows). */
  discountInPaise: bigint;
  /**
   * GST rate in basis points (5% → 500, 18% → 1800, 28% → 2800).
   * Sourced from the product/HSN at order time.
   */
  gstRateBps: number;
  /**
   * Intra-state supply gets CGST+SGST (each half the total rate).
   * Inter-state supply gets IGST (full rate). Determined by
   * comparing seller GSTIN state vs customer shipping state.
   */
  isIntraState: boolean;
}

export interface GstResult {
  grossInPaise: bigint;
  discountInPaise: bigint;
  /** Taxable value = gross - discount. The base for GST. */
  taxableInPaise: bigint;
  gstRateBps: number;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  totalTaxInPaise: bigint;
  /** Final line total = taxable + total tax. */
  lineTotalInPaise: bigint;
}

/**
 * Compute per-line GST after discount allocation.
 *
 * Examples:
 *   ₹1,000 (100,000 paise) gross, ₹200 discount, 18%, intra-state
 *     → taxable ₹800, CGST ₹72, SGST ₹72, total tax ₹144,
 *       line total ₹944.
 *   Same with inter-state:
 *     → taxable ₹800, IGST ₹144, line total ₹944.
 *   100% discount (free item):
 *     → taxable ₹0, all GST ₹0, line total ₹0.
 */
export function calculateLineGst(input: GstInput): GstResult {
  if (input.grossInPaise < 0n) {
    throw new Error('grossInPaise cannot be negative');
  }
  if (input.discountInPaise < 0n) {
    throw new Error('discountInPaise cannot be negative');
  }
  if (input.discountInPaise > input.grossInPaise) {
    throw new Error(
      `discountInPaise (${input.discountInPaise}) cannot exceed grossInPaise (${input.grossInPaise})`,
    );
  }
  if (!Number.isInteger(input.gstRateBps) || input.gstRateBps < 0) {
    throw new Error('gstRateBps must be a non-negative integer');
  }

  const taxable = input.grossInPaise - input.discountInPaise;
  const rateBps = BigInt(input.gstRateBps);

  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;

  if (input.isIntraState) {
    // CGST + SGST. Each gets half the rate. We compute each half
    // independently from `taxable × halfRate / 10000` so any odd-
    // paise rounding stays per-component (typical Indian invoice
    // practice — CGST and SGST shown separately and summed).
    const halfBps = rateBps / 2n;
    // If rate is odd (e.g., 5% = 500 bps → 250 each, fine), the
    // half stays exact. For odd-bps rates (e.g. hypothetical 7% =
    // 700 → 350 each), still exact. Indian GST rates are always
    // even bps so this works.
    cgst = (taxable * halfBps) / 10_000n;
    sgst = (taxable * halfBps) / 10_000n;
    // For odd-rate edge cases, force exact total tax by deriving
    // SGST from total - CGST.
    const expectedTotalTax = (taxable * rateBps) / 10_000n;
    sgst = expectedTotalTax - cgst;
  } else {
    igst = (taxable * rateBps) / 10_000n;
  }

  const totalTax = cgst + sgst + igst;
  const lineTotal = taxable + totalTax;

  return {
    grossInPaise: input.grossInPaise,
    discountInPaise: input.discountInPaise,
    taxableInPaise: taxable,
    gstRateBps: input.gstRateBps,
    cgstInPaise: cgst,
    sgstInPaise: sgst,
    igstInPaise: igst,
    totalTaxInPaise: totalTax,
    lineTotalInPaise: lineTotal,
  };
}

/**
 * Compute the proportional GST reversal for a return / partial
 * return. Used by P0.2's refund proration to write
 * `return_tax_reversal_lines` rows.
 *
 * Formula: scale the original snapshot's reversal components by
 * (returnedQty / purchasedQty), using BigInt math so paise stay
 * exact.
 */
export interface ReversalInput {
  /** Original snapshot fields from `OrderItemTaxSnapshot`. */
  originalGrossInPaise: bigint;
  originalDiscountInPaise: bigint;
  originalCgstInPaise: bigint;
  originalSgstInPaise: bigint;
  originalIgstInPaise: bigint;
  purchasedQuantity: number;
  returnedQuantity: number;
}

export interface ReversalResult {
  grossReturnedInPaise: bigint;
  discountReversalInPaise: bigint;
  taxableReversalInPaise: bigint;
  cgstReversalInPaise: bigint;
  sgstReversalInPaise: bigint;
  igstReversalInPaise: bigint;
  totalTaxReversalInPaise: bigint;
  totalCreditNoteInPaise: bigint;
}

export function calculateGstReversal(input: ReversalInput): ReversalResult {
  if (input.purchasedQuantity <= 0) {
    throw new Error('purchasedQuantity must be > 0');
  }
  if (input.returnedQuantity <= 0) {
    throw new Error('returnedQuantity must be > 0');
  }
  if (input.returnedQuantity > input.purchasedQuantity) {
    throw new Error(
      `returnedQuantity (${input.returnedQuantity}) cannot exceed purchasedQuantity (${input.purchasedQuantity})`,
    );
  }

  const purchased = BigInt(input.purchasedQuantity);
  const returned = BigInt(input.returnedQuantity);

  // Proportional: each component scaled by returnedQty / purchasedQty.
  // BigInt division floors — that's correct here (we never want to
  // refund a paise we didn't collect).
  const grossReturned = (input.originalGrossInPaise * returned) / purchased;
  const discountReversal =
    (input.originalDiscountInPaise * returned) / purchased;
  const taxableReversal = grossReturned - discountReversal;
  const cgstReversal = (input.originalCgstInPaise * returned) / purchased;
  const sgstReversal = (input.originalSgstInPaise * returned) / purchased;
  const igstReversal = (input.originalIgstInPaise * returned) / purchased;
  const totalTaxReversal = cgstReversal + sgstReversal + igstReversal;
  const totalCreditNote = taxableReversal + totalTaxReversal;

  return {
    grossReturnedInPaise: grossReturned,
    discountReversalInPaise: discountReversal,
    taxableReversalInPaise: taxableReversal,
    cgstReversalInPaise: cgstReversal,
    sgstReversalInPaise: sgstReversal,
    igstReversalInPaise: igstReversal,
    totalTaxReversalInPaise: totalTaxReversal,
    totalCreditNoteInPaise: totalCreditNote,
  };
}
