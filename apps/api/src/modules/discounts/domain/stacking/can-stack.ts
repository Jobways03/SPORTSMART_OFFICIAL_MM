// Phase E (P1.2) — Stacking compatibility evaluator.
//
// Semantics: a discount's `combine*` flags name the *classes* it
// allows itself to stack with:
//
//   combineProduct  ⇨ "I allow stacking with PRODUCT_DISCOUNT or BXGY"
//   combineOrder    ⇨ "I allow stacking with ORDER_DISCOUNT, AUTOMATIC_PROMO, or AFFILIATE_COUPON"
//   combineShipping ⇨ "I allow stacking with SHIPPING_DISCOUNT"
//
// For two discounts X and Y to coexist on a cart, BOTH sides must
// have opted in via the flag that maps to the OTHER's class. This
// gives us a single, symmetric rule that covers every spec case
// (only-one-manual, product+order, BXGY+product, automatic+manual,
// affiliate-no-stack) without per-pair branching.
//
// Self-stacking (same discount id twice) is always rejected — would
// double-count the discount and bypass maxUses.

import { classifyDiscount } from './classify';
import type {
  DiscountClass,
  StackableDiscount,
  StackingDecision,
} from './types';

export function canStack(
  applied: ReadonlyArray<StackableDiscount>,
  candidate: StackableDiscount,
): StackingDecision {
  const candidateClass = classifyDiscount(candidate);

  if (applied.length === 0) {
    return { allowed: true, candidateClass };
  }

  // Self-stacking guard.
  const dup = applied.find((a) => a.id === candidate.id);
  if (dup) {
    return {
      allowed: false,
      reason: 'This coupon is already applied.',
      candidateClass,
      conflictWithDiscountId: dup.id,
      conflictWithClass: classifyDiscount(dup),
    };
  }

  // Check candidate against every applied discount. First conflict
  // wins — the customer gets a single rejection reason and removes
  // the offending coupon (or the new one) to retry.
  for (const a of applied) {
    const aClass = classifyDiscount(a);
    if (!isPairCompatible(a, aClass, candidate, candidateClass)) {
      return {
        allowed: false,
        reason: rejectionReason(aClass, candidateClass),
        candidateClass,
        conflictWithDiscountId: a.id,
        conflictWithClass: aClass,
      };
    }
  }

  return { allowed: true, candidateClass };
}

/**
 * Cross-flag compatibility check. Symmetric in the general case
 * (both sides must opt in via the OTHER's class flag), with one
 * special case for shipping:
 *
 * If either side is SHIPPING_DISCOUNT, only `combineShipping` on
 * both matters — we don't require the order/product side to also
 * opt in via its class flag. This matches the spec's "Free shipping
 * can stack only if combineShipping=true" rule, which treats
 * shipping as a single-flag toggle.
 */
function isPairCompatible(
  existing: StackableDiscount,
  existingClass: DiscountClass,
  candidate: StackableDiscount,
  candidateClass: DiscountClass,
): boolean {
  if (
    existingClass === 'SHIPPING_DISCOUNT' ||
    candidateClass === 'SHIPPING_DISCOUNT'
  ) {
    return existing.combineShipping && candidate.combineShipping;
  }
  return (
    existing[combineFlagFor(candidateClass)] &&
    candidate[combineFlagFor(existingClass)]
  );
}

/**
 * Map a class to the flag name that controls "I allow stacking
 * with this class". One flag per class family — kept simple so
 * the admin form stays readable (only 3 checkboxes).
 *
 * AUTOMATIC_PROMO and AFFILIATE_COUPON share the combineOrder
 * lane because both behave like order-level reductions from the
 * cart's perspective (a manual coupon's combineOrder=true is the
 * same opt-in for either).
 */
function combineFlagFor(
  cls: DiscountClass,
): 'combineProduct' | 'combineOrder' | 'combineShipping' {
  switch (cls) {
    case 'SHIPPING_DISCOUNT':
      return 'combineShipping';
    case 'PRODUCT_DISCOUNT':
    case 'BUY_X_GET_Y':
      return 'combineProduct';
    case 'ORDER_DISCOUNT':
    case 'AUTOMATIC_PROMO':
    case 'AFFILIATE_COUPON':
      return 'combineOrder';
  }
}

/**
 * Pick a customer-friendly rejection reason. Spec wording for the
 * generic case ("This coupon cannot be combined with the current
 * promotion."), with a slightly more specific message for shipping
 * and affiliate so the customer knows which constraint hit.
 */
function rejectionReason(
  existingClass: DiscountClass,
  candidateClass: DiscountClass,
): string {
  if (
    existingClass === 'SHIPPING_DISCOUNT' ||
    candidateClass === 'SHIPPING_DISCOUNT'
  ) {
    return 'Shipping discounts cannot be combined with this coupon.';
  }
  if (
    existingClass === 'AFFILIATE_COUPON' ||
    candidateClass === 'AFFILIATE_COUPON'
  ) {
    return 'Affiliate coupons cannot be combined with other promotions.';
  }
  return 'This coupon cannot be combined with the current promotion.';
}
