// Phase E (P1.2) — Classify a Discount into one of six stacking
// classes. Source has priority over type+method:
//
//   AFFILIATE coupons (resolved via the affiliate facade) are always
//     AFFILIATE_COUPON regardless of underlying type.
//   AUTOMATIC method = AUTOMATIC_PROMO (banner/cart-rule promos).
//   FREE_SHIPPING type = SHIPPING_DISCOUNT (always, regardless of method).
//   BUY_X_GET_Y = BUY_X_GET_Y.
//   AMOUNT_OFF_ORDER = ORDER_DISCOUNT.
//   AMOUNT_OFF_PRODUCTS = PRODUCT_DISCOUNT.

import type { DiscountClass, StackableDiscount } from './types';

export function classifyDiscount(d: StackableDiscount): DiscountClass {
  // Source check first — affiliate coupons live in their own class.
  if (d.source === 'AFFILIATE') return 'AFFILIATE_COUPON';
  // Method check next — any AUTOMATIC promo is in AUTOMATIC_PROMO,
  // even if it's technically AMOUNT_OFF_ORDER under the hood.
  if (d.method === 'AUTOMATIC') return 'AUTOMATIC_PROMO';

  switch (d.type) {
    case 'FREE_SHIPPING':
      return 'SHIPPING_DISCOUNT';
    case 'BUY_X_GET_Y':
      return 'BUY_X_GET_Y';
    case 'AMOUNT_OFF_ORDER':
      return 'ORDER_DISCOUNT';
    case 'AMOUNT_OFF_PRODUCTS':
      return 'PRODUCT_DISCOUNT';
  }
}
