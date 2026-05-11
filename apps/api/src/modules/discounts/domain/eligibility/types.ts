// Phase E (P1.3) — Eligibility evaluator types.
//
// All evaluator inputs are pure data — caller (the service layer)
// loads from Prisma + checkout session and feeds in. Keeps the
// engine unit-testable without a DB.

export type EligibilityRuleType =
  | 'FIRST_ORDER_ONLY'
  | 'NEW_CUSTOMER_ONLY'
  | 'CUSTOMER_TIER_IN'
  | 'CUSTOMER_SEGMENT_IN'
  | 'SELLER_IN'
  | 'CATEGORY_IN'
  | 'PRODUCT_IN'
  | 'COLLECTION_IN'
  | 'PAYMENT_METHOD_IN'
  | 'CITY_IN'
  | 'PINCODE_IN'
  | 'MIN_CART_VALUE'
  | 'MIN_ELIGIBLE_ITEM_QUANTITY'
  | 'MAX_REDEMPTIONS_PER_CUSTOMER'
  | 'MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW'
  | 'MIN_DAYS_BETWEEN_REDEMPTIONS';

export interface EligibilityRule {
  ruleType: EligibilityRuleType;
  /** Free-form per ruleType — see migration 20260508150000 docstring. */
  valueJson: Record<string, unknown>;
}

/**
 * Snapshot of customer + cart state at coupon validation time.
 * Caller fills in only what's relevant; missing fields cause the
 * matching rule type to short-circuit to "skip" (treats as pass)
 * rather than reject — preserves backward-compat for legacy
 * callers that don't supply the new fields yet.
 */
export interface EligibilityContext {
  /** The customer attempting to redeem. */
  customer?: {
    id: string;
    /** Number of paid orders (for FIRST_ORDER_ONLY). */
    paidOrderCount?: number;
    /** Account creation timestamp (for NEW_CUSTOMER_ONLY). */
    accountAgeDays?: number;
    /** Loyalty tier (for CUSTOMER_TIER_IN). */
    tier?: string | null;
    /** Marketing segments (for CUSTOMER_SEGMENT_IN). */
    segments?: string[];
  };
  /** The cart being checked out. */
  cart?: {
    items: Array<{
      productId: string;
      variantId?: string | null;
      sellerId?: string | null;
      categoryId?: string | null;
      collectionIds?: string[];
      quantity: number;
      unitPriceInPaise: bigint;
    }>;
    paymentMethod?: 'COD' | 'ONLINE' | 'WALLET' | 'UPI' | string;
    address?: {
      city?: string | null;
      pincode?: string | null;
      state?: string | null;
    };
  };
  /**
   * Customer's prior redemption history for THIS discount —
   * needed by the velocity rules. Caller queries
   * discount_redemptions filtered to (discountId, customerId,
   * status='REDEEMED').
   */
  redemptionHistory?: Array<{
    redeemedAt: Date;
  }>;
}

export interface EligibilityVerdict {
  allowed: boolean;
  /** Customer-friendly reason for rejection. Always set on rejection. */
  reason?: string;
  /** Which rule fired — for admin reporting / abuse signals. */
  ruleType?: EligibilityRuleType;
}
