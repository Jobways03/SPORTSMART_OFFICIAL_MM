// Phase E (P1.2) — Discount stacking domain types.
//
// The stacking engine answers a single question: given a set of
// already-applied discounts on a cart, can a candidate new discount
// be added on top? Result is yes/no + a customer-friendly rejection
// reason. Pure functions only — no Prisma dependencies.

/**
 * Six classes per spec. Every Discount maps to exactly one class
 * via `classifyDiscount()`. The compatibility matrix is keyed on
 * pairs of classes.
 */
export type DiscountClass =
  | 'PRODUCT_DISCOUNT' // AMOUNT_OFF_PRODUCTS
  | 'ORDER_DISCOUNT' // AMOUNT_OFF_ORDER
  | 'SHIPPING_DISCOUNT' // FREE_SHIPPING
  | 'BUY_X_GET_Y' // BXGY
  | 'AFFILIATE_COUPON' // any code resolved through the affiliate facade
  | 'AUTOMATIC_PROMO'; // method=AUTOMATIC, any type

/**
 * Minimum data needed to classify a discount + evaluate stacking.
 * Caller fills in from a Discount row + the source resolver
 * (CODE / AUTOMATIC / AFFILIATE).
 */
export interface StackableDiscount {
  /** Stable identifier so we can flag self-stacking attempts. */
  id: string;
  type: 'AMOUNT_OFF_PRODUCTS' | 'AMOUNT_OFF_ORDER' | 'BUY_X_GET_Y' | 'FREE_SHIPPING';
  method: 'CODE' | 'AUTOMATIC';
  source: 'CODE' | 'AUTOMATIC' | 'AFFILIATE';
  /**
   * Combine flags from the parent Discount row. Each one toggles
   * compatibility with a class:
   *   combineProduct   ⇨ may stack with PRODUCT_DISCOUNT
   *   combineOrder     ⇨ may stack with ORDER_DISCOUNT
   *   combineShipping  ⇨ may stack with SHIPPING_DISCOUNT
   * Default false (preserves current "single coupon" behavior for
   * legacy discounts that haven't opted in).
   */
  combineProduct: boolean;
  combineOrder: boolean;
  combineShipping: boolean;
}

export interface StackingDecision {
  allowed: boolean;
  /**
   * Customer-friendly rejection reason. The spec wording — fine to
   * surface at checkout. Always populated when `allowed=false`.
   */
  reason?: string;
  /**
   * Internal classification of the candidate + the conflict source,
   * for admin reporting / abuse detection. Never shown to customer.
   */
  candidateClass?: DiscountClass;
  conflictWithDiscountId?: string;
  conflictWithClass?: DiscountClass;
}
