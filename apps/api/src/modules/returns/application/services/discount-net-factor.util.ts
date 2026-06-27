// Order-level discount net-factor — the fraction of an item's GROSS line price
// a customer actually paid after an AMOUNT_OFF_ORDER coupon.
//
// Used by the return-refund path as a FALLBACK when no per-item
// discount-allocation snapshot exists (DISCOUNT_ALLOCATION_ENABLED off — the
// default, so this is the live path for every order placed via the legacy
// checkout pipeline). Without it the refund falls back to the gross line price
// and over-refunds any coupon order: SM20260000026 paid ₹818.10
// (₹909 − ₹90.90) but was refunded the full ₹909.
//
//   preDiscountSubtotal = total + discount − shipping   (Σ item gross)
//   netFactor           = (total − shipping) / preDiscountSubtotal
//                       = (subtotal − discount) / subtotal
//
// `total` is the master-order total (post-discount, INCLUDING shipping), so
// shipping is removed from both numerator and denominator — otherwise a
// non-zero shipping fee would dilute the discount ratio and over-refund.
// AMOUNT_OFF_ORDER spreads proportionally across every line, so this
// order-level factor is the correct per-item factor regardless of how many
// items / sub-orders the order has.

export interface OrderDiscountNetFactorInput {
  /** Master-order total in paise (post-discount, includes shipping). */
  totalPaise: number;
  /** Order-level discount in paise (AMOUNT_OFF_ORDER). */
  discountPaise: number;
  /** Shipping fee in paise — excluded from the ratio. */
  shippingPaise: number;
}

/**
 * Returns the net-paid fraction in [0, 1].
 *
 * - No discount (or non-positive pre-discount subtotal) → 1 (no behavior
 *   change; a gross refund stays a gross refund).
 * - Otherwise the proportional net factor, clamped to [0, 1] defensively so a
 *   malformed total can never produce a negative or >100% refund.
 */
export function computeOrderDiscountNetFactor(
  input: OrderDiscountNetFactorInput,
): number {
  const total = Number(input.totalPaise) || 0;
  const discount = Number(input.discountPaise) || 0;
  const shipping = Number(input.shippingPaise) || 0;

  const preDiscountSubtotal = total + discount - shipping;
  if (discount <= 0 || preDiscountSubtotal <= 0) return 1;

  const factor = (total - shipping) / preDiscountSubtotal;
  return Math.max(0, Math.min(1, factor));
}
