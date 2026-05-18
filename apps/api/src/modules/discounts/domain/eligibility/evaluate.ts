// Phase E (P1.3) — Eligibility evaluator (pure functions).
//
// Runs each rule against the context. First failure short-circuits
// and returns the customer-friendly rejection. If a rule's
// dependency isn't supplied (e.g. CUSTOMER_TIER_IN with no
// `customer.tier` in context) the rule SKIPS — treats as a pass so
// legacy callers that haven't plumbed the new fields don't crash.
// This is a deliberate forward-compat trade-off: ops can configure
// rules ahead of customer-data plumbing without breaking validation.

import type {
  EligibilityContext,
  EligibilityRule,
  EligibilityRuleType,
  EligibilityVerdict,
} from './types';

export function evaluateEligibility(
  rules: ReadonlyArray<EligibilityRule>,
  ctx: EligibilityContext,
): EligibilityVerdict {
  if (rules.length === 0) {
    return { allowed: true };
  }
  for (const rule of rules) {
    const verdict = evaluateRule(rule, ctx);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}

function evaluateRule(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  switch (rule.ruleType) {
    case 'FIRST_ORDER_ONLY':
      return evalFirstOrderOnly(ctx);
    case 'NEW_CUSTOMER_ONLY':
      return evalNewCustomerOnly(rule, ctx);
    case 'CUSTOMER_TIER_IN':
      return evalCustomerTierIn(rule, ctx);
    case 'CUSTOMER_SEGMENT_IN':
      return evalCustomerSegmentIn(rule, ctx);
    case 'SELLER_IN':
      return evalSellerIn(rule, ctx);
    case 'CATEGORY_IN':
      return evalCategoryIn(rule, ctx);
    case 'PRODUCT_IN':
      return evalProductIn(rule, ctx);
    case 'COLLECTION_IN':
      return evalCollectionIn(rule, ctx);
    case 'PAYMENT_METHOD_IN':
      return evalPaymentMethodIn(rule, ctx);
    case 'CITY_IN':
      return evalCityIn(rule, ctx);
    case 'PINCODE_IN':
      return evalPincodeIn(rule, ctx);
    case 'MIN_CART_VALUE':
      return evalMinCartValue(rule, ctx);
    case 'MIN_ELIGIBLE_ITEM_QUANTITY':
      return evalMinEligibleItemQuantity(rule, ctx);
    case 'MAX_REDEMPTIONS_PER_CUSTOMER':
      return evalMaxRedemptionsPerCustomer(rule, ctx);
    case 'MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW':
      return evalMaxRedemptionsPerCustomerWindow(rule, ctx);
    case 'MIN_DAYS_BETWEEN_REDEMPTIONS':
      return evalMinDaysBetweenRedemptions(rule, ctx);
    default:
      // Forward-compat: unknown rule type → skip rather than reject.
      // Lets ops configure new rule types ahead of evaluator support.
      return { allowed: true };
  }
}

const reject = (
  ruleType: EligibilityRuleType,
  reason: string,
): EligibilityVerdict => ({ allowed: false, reason, ruleType });

const skip = (): EligibilityVerdict => ({ allowed: true });

// ──────────────────────────────────────────────────────────
// Rule implementations
// ──────────────────────────────────────────────────────────

function evalFirstOrderOnly(ctx: EligibilityContext): EligibilityVerdict {
  if (!ctx.customer) return skip();
  if (ctx.customer.paidOrderCount === undefined) return skip();
  if (ctx.customer.paidOrderCount > 0) {
    return reject(
      'FIRST_ORDER_ONLY',
      'This coupon is only valid on your first order.',
    );
  }
  return { allowed: true };
}

function evalNewCustomerOnly(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  if (!ctx.customer) return skip();
  // Two conditions per spec default decision #7: no previous PAID
  // order AND account age < threshold (default 30 days).
  const maxAge = Number(rule.valueJson?.maxAccountAgeDays ?? 30);
  if (ctx.customer.paidOrderCount !== undefined && ctx.customer.paidOrderCount > 0) {
    return reject(
      'NEW_CUSTOMER_ONLY',
      'This coupon is only valid for new customers.',
    );
  }
  if (
    ctx.customer.accountAgeDays !== undefined &&
    ctx.customer.accountAgeDays > maxAge
  ) {
    return reject(
      'NEW_CUSTOMER_ONLY',
      'This coupon is only valid for new customers.',
    );
  }
  return { allowed: true };
}

function evalCustomerTierIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed = (rule.valueJson?.tiers as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.customer || !ctx.customer.tier) return skip();
  return allowed.includes(ctx.customer.tier)
    ? { allowed: true }
    : reject(
        'CUSTOMER_TIER_IN',
        'This coupon is not valid for your customer tier.',
      );
}

function evalCustomerSegmentIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed = (rule.valueJson?.segments as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.customer || !ctx.customer.segments) return skip();
  const overlap = ctx.customer.segments.some((s) => allowed.includes(s));
  return overlap
    ? { allowed: true }
    : reject(
        'CUSTOMER_SEGMENT_IN',
        'This coupon is not valid for your account.',
      );
}

function evalSellerIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed = (rule.valueJson?.sellerIds as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.cart) return skip();
  const cartSellers = new Set(
    ctx.cart.items.map((i) => i.sellerId).filter((s): s is string => !!s),
  );
  const overlap = [...cartSellers].some((s) => allowed.includes(s));
  return overlap
    ? { allowed: true }
    : reject(
        'SELLER_IN',
        'This coupon is not valid for items in your cart.',
      );
}

function evalCategoryIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed = (rule.valueJson?.categoryIds as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.cart) return skip();
  const overlap = ctx.cart.items.some(
    (i) => i.categoryId && allowed.includes(i.categoryId),
  );
  return overlap
    ? { allowed: true }
    : reject(
        'CATEGORY_IN',
        'This coupon is not valid for items in your cart.',
      );
}

function evalProductIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed = (rule.valueJson?.productIds as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.cart) return skip();
  const overlap = ctx.cart.items.some((i) => allowed.includes(i.productId));
  return overlap
    ? { allowed: true }
    : reject(
        'PRODUCT_IN',
        'This coupon is not valid for items in your cart.',
      );
}

function evalCollectionIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed =
    (rule.valueJson?.collectionIds as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.cart) return skip();
  const overlap = ctx.cart.items.some((i) =>
    (i.collectionIds ?? []).some((c) => allowed.includes(c)),
  );
  return overlap
    ? { allowed: true }
    : reject(
        'COLLECTION_IN',
        'This coupon is not valid for items in your cart.',
      );
}

function evalPaymentMethodIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed = (rule.valueJson?.methods as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.cart || !ctx.cart.paymentMethod) return skip();
  return allowed.includes(ctx.cart.paymentMethod)
    ? { allowed: true }
    : reject(
        'PAYMENT_METHOD_IN',
        'This coupon is not valid for the selected payment method.',
      );
}

function evalCityIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed = (rule.valueJson?.cities as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.cart?.address?.city) return skip();
  return allowed.map((c) => c.toLowerCase()).includes(ctx.cart.address.city.toLowerCase())
    ? { allowed: true }
    : reject(
        'CITY_IN',
        'This coupon is not available in your delivery city.',
      );
}

function evalPincodeIn(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const allowed = (rule.valueJson?.pincodes as string[] | undefined) ?? [];
  if (allowed.length === 0) return skip();
  if (!ctx.cart?.address?.pincode) return skip();
  return allowed.includes(ctx.cart.address.pincode)
    ? { allowed: true }
    : reject(
        'PINCODE_IN',
        'This coupon is not available in your delivery area.',
      );
}

function evalMinCartValue(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const minPaise = BigInt(Number(rule.valueJson?.minPaise ?? 0));
  if (minPaise <= 0n) return skip();
  if (!ctx.cart) return skip();
  const total = ctx.cart.items.reduce(
    (a, i) => a + i.unitPriceInPaise * BigInt(i.quantity),
    0n,
  );
  if (total < minPaise) {
    const shortfallRupees = Number(minPaise - total) / 100;
    return reject(
      'MIN_CART_VALUE',
      `Add ₹${shortfallRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more to use this coupon.`,
    );
  }
  return { allowed: true };
}

function evalMinEligibleItemQuantity(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const minQty = Number(rule.valueJson?.minQuantity ?? 0);
  if (minQty <= 0) return skip();
  if (!ctx.cart) return skip();
  const totalQty = ctx.cart.items.reduce((a, i) => a + i.quantity, 0);
  if (totalQty < minQty) {
    return reject(
      'MIN_ELIGIBLE_ITEM_QUANTITY',
      `Add ${minQty - totalQty} more eligible item${
        minQty - totalQty === 1 ? '' : 's'
      } to use this coupon.`,
    );
  }
  return { allowed: true };
}

function evalMaxRedemptionsPerCustomer(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const max = Number(rule.valueJson?.max ?? 0);
  if (max <= 0) return skip();
  if (ctx.redemptionHistory === undefined) return skip();
  if (ctx.redemptionHistory.length >= max) {
    return reject(
      'MAX_REDEMPTIONS_PER_CUSTOMER',
      'You have already used this coupon the maximum number of times.',
    );
  }
  return { allowed: true };
}

function evalMaxRedemptionsPerCustomerWindow(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const max = Number(rule.valueJson?.max ?? 0);
  const windowDays = Number(rule.valueJson?.windowDays ?? 0);
  if (max <= 0 || windowDays <= 0) return skip();
  if (ctx.redemptionHistory === undefined) return skip();

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = ctx.redemptionHistory.filter(
    (r) => r.redeemedAt.getTime() >= cutoff,
  ).length;
  if (inWindow >= max) {
    return reject(
      'MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW',
      'You have already used this coupon recently.',
    );
  }
  return { allowed: true };
}

function evalMinDaysBetweenRedemptions(
  rule: EligibilityRule,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const minDays = Number(rule.valueJson?.days ?? 0);
  if (minDays <= 0) return skip();
  if (!ctx.redemptionHistory || ctx.redemptionHistory.length === 0)
    return { allowed: true };
  const last = ctx.redemptionHistory.reduce(
    (a, r) => (r.redeemedAt > a ? r.redeemedAt : a),
    ctx.redemptionHistory[0]!.redeemedAt,
  );
  const diffDays = (Date.now() - last.getTime()) / (24 * 60 * 60 * 1000);
  if (diffDays < minDays) {
    const wait = Math.ceil(minDays - diffDays);
    return reject(
      'MIN_DAYS_BETWEEN_REDEMPTIONS',
      `You can use this coupon again in ${wait} day${wait === 1 ? '' : 's'}.`,
    );
  }
  return { allowed: true };
}
