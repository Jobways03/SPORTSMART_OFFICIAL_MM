// Phase B (P0.1) — Allocation domain types.
//
// Pure-data shapes for the allocation engine. All money is in paise
// (BigInt) to avoid 53-bit precision loss on > ~₹90 lakh totals
// (ADR-007). Allocation functions never mutate input; they return
// fresh allocation arrays.

/**
 * Minimum line-item shape needed by the allocation engine. Sourced
 * from `OrderItem` server-side at order-creation time — never from
 * the client.
 */
export interface AllocatableItem {
  /** Stable identifier — used for tie-breaking deterministic rounding. */
  orderItemId: string;
  productId: string;
  variantId?: string | null;
  /** SubOrder + seller for multi-seller allocation. */
  subOrderId: string;
  sellerId?: string | null;
  /** Pre-discount line gross = unitPrice × quantity, in paise. */
  grossInPaise: bigint;
  /** Used by BXGY's cheapest-first selection. */
  unitPriceInPaise: bigint;
  quantity: number;
}

/**
 * One item's slice of a discount. Sum of all `discountInPaise` for a
 * single discount must equal the discount's total. Caller writes one
 * `OrderItemDiscount` row per allocation.
 */
export interface ItemAllocation {
  orderItemId: string;
  productId: string;
  variantId?: string | null;
  subOrderId: string;
  sellerId?: string | null;
  discountInPaise: bigint;
}

/** Order-level percentage / fixed discount input. */
export interface OrderLevelDiscountInput {
  /** All items in the order. Eligibility narrows from this set. */
  items: ReadonlyArray<AllocatableItem>;
  /**
   * Total discount the customer was promised, in paise. The
   * allocation must sum to exactly this value (conservation rule).
   */
  totalDiscountInPaise: bigint;
  /**
   * Optional eligibility filter — when defined, allocation only
   * applies to items whose `productId` is in this set (used for
   * AMOUNT_OFF_PRODUCTS and SPECIFIC_COLLECTIONS scopes). Other
   * items get a zero allocation row (or are omitted; both forms
   * are correct).
   */
  eligibleProductIds?: ReadonlySet<string>;
}

/** BXGY input. */
export interface BxgyDiscountInput {
  items: ReadonlyArray<AllocatableItem>;
  /**
   * Items eligible to be GET items — typically the items
   * referenced by DiscountProduct/DiscountCollection rows with
   * scope=GET. Caller resolves the set from the cart before
   * calling.
   */
  getEligibleProductIds: ReadonlySet<string>;
  /** How many GET items are discounted (each unit counts). */
  getQuantity: number;
  /**
   * What kind of discount applies to each GET unit. FREE makes
   * the unit ₹0; PERCENTAGE/AMOUNT_OFF reduces the unit price
   * by the value, capped at the unit price.
   */
  getDiscountType: 'FREE' | 'PERCENTAGE' | 'AMOUNT_OFF';
  /**
   * For PERCENTAGE: 0–100. For AMOUNT_OFF: paise per unit. Ignored
   * for FREE.
   */
  getDiscountValueInPaise?: bigint;
  getDiscountPercentage?: number;
}

/** Result of any allocation, with the conservation invariant proven. */
export interface AllocationResult {
  allocations: ItemAllocation[];
  /** Sum of all `discountInPaise` — should equal the requested total. */
  totalAllocatedInPaise: bigint;
}
