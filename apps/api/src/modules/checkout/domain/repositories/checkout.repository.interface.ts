// ── Checkout Repository Interface ─────────────────────────────────────────
// Domain contract — no framework or Prisma references leak into this layer.

export const CHECKOUT_REPOSITORY = Symbol('CHECKOUT_REPOSITORY');

// ── Address types ──────────────────────────────────────────────────────────

export type AddressType = 'HOME' | 'WORK' | 'OTHER';

export interface CustomerAddressEntity {
  id: string;
  customerId: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
  // Phase 63 (2026-05-22) — landmark + addressType (audit Gap #6).
  landmark: string | null;
  city: string;
  state: string;
  // Phase 34 — canonical CBIC 2-digit GST state code. May be null on
  // legacy rows where the backfill could not resolve the free-text
  // state name; the tax engine still works via the runtime name-lookup
  // fallback in tax/domain/state-code-map.ts.
  stateCode: string | null;
  postalCode: string;
  country: string | null;
  isDefault: boolean;
  addressType: AddressType | null;
  // Phase 63 — soft delete (audit Gaps #2 + #3).
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAddressInput {
  customerId: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  locality?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  // Phase 34 — optional canonical CBIC 2-digit GST state code. When
  // omitted, the repository resolves it by name against india_states
  // at write time. Passing an explicit value (e.g. from a future UI
  // that selects from a dropdown) skips the lookup.
  stateCode?: string | null;
  postalCode: string;
  isDefault?: boolean;
  addressType?: AddressType | null;
}

export interface UpdateAddressInput {
  fullName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  locality?: string | null;
  landmark?: string | null;
  city?: string;
  state?: string;
  // Phase 34 — when `state` is updated, the repository re-resolves
  // stateCode from india_states. Explicit `stateCode` overrides.
  stateCode?: string | null;
  postalCode?: string;
  isDefault?: boolean;
  addressType?: AddressType | null;
}

// ── Cart types ─────────────────────────────────────────────────────────────

export interface CartWithItems {
  id: string;
  customerId: string;
  items: CartItemWithRelations[];
}

export interface CartItemWithRelations {
  id: string;
  cartId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  product: {
    id: string;
    title: string;
    slug: string;
    basePrice: any;
    baseSku: string | null;
    baseStock?: number | null;
    hasVariants: boolean;
    status: string;
    images: { url: string }[];
    seller?: { id: string; sellerShopName: string | null } | null;
  };
  variant: {
    id: string;
    title: string | null;
    price: any;
    stock?: number;
    sku: string | null;
    status: string;
    images: { url: string }[];
  } | null;
}

// ── Order types ────────────────────────────────────────────────────────────

export interface MasterOrderEntity {
  id: string;
  orderNumber: string;
  customerId: string;
  totalAmount: number;
  itemCount: number;
  orderStatus: string;
  paymentStatus: string;
  subOrders: SubOrderEntity[];
}

export interface SubOrderEntity {
  id: string;
  masterOrderId: string;
  sellerId: string | null;
  franchiseId: string | null;
  fulfillmentNodeType: string;
  subTotal: number;
  fulfillmentStatus: string;
  acceptStatus: string;
  paymentStatus: string;
  returnWindowEndsAt: Date | null;
  commissionProcessed: boolean;
  items: OrderItemEntity[];
}

export interface OrderItemEntity {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface CreateOrderItemInput {
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  masterSku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  // Phase 44 (2026-05-21) — pricing-tier snapshot. unitPrice is the
  // tier-adjusted (effective) price the customer paid; these fields
  // record what tier was applied so refunds, disputes, and commission
  // re-computation can prove the discount delta.
  appliedPricingTierId?: string | null;
  appliedDiscountPercent?: number | null;
  appliedFixedUnitPrice?: number | null;
  appliedListUnitPrice?: number | null;
  // Phase 67 (2026-05-22) — media public id snapshot (audit
  // Gap #23). Forward-compat: passed through to OrderItem if the
  // checkout session resolved it from the product images; null
  // otherwise (no UI regression today).
  imagePublicId?: string | null;
}

export interface CreatedSubOrderInfo {
  subOrderId: string;
  sellerId: string | null;
  franchiseId: string | null;
  fulfillmentNodeType: 'SELLER' | 'FRANCHISE';
  nodeName: string | null;
  subTotal: number;
  itemCount: number;
}

export interface FulfillmentGroupInput {
  items: CreateOrderItemInput[];
  nodeName: string | null;
  nodeType: 'SELLER' | 'FRANCHISE';
  nodeId: string;
  commissionRateSnapshot?: number | null;
  // Phase 67 (2026-05-22) — per-group SLA hours (audit Gaps #6 + #22).
  // Drives sub_orders.accept_deadline_at at create time so the
  // accept-deadline sweeper has a value to act on. Falls back to
  // the platform default (24h) when omitted.
  acceptSlaHours?: number;
}

export interface PlaceOrderTransactionInput {
  customerId: string;
  addressSnapshot: Record<string, any>;
  totalAmount: number;
  itemCount: number;
  paymentMethod?: 'COD' | 'ONLINE';
  fulfillmentGroups: Record<string, FulfillmentGroupInput>;
  discountCode?: string | null;
  discountAmount?: number;
  // Affiliate attribution resolved by the AffiliatePublicFacade.
  // null when the order has no affiliate. When set, the repo writes
  // a ReferralAttribution row inside the same transaction.
  //
  // Phase 62 (2026-05-22) — `customerId` populated so the repo can
  // enforce AffiliateCouponCode.perUserLimit inside the row-lock
  // (audit Gap #3) and persist customerId on the attribution row
  // for the self-referral guard backstop (audit Gap #1).
  affiliateAttribution?: {
    affiliateId: string;
    source: 'LINK' | 'COUPON';
    code: string;
    customerId?: string | null;
    // Phase 159c — FK to the originating coupon row (resolved by the facade).
    couponCodeId?: string | null;
  } | null;
  // Shipping (v1) — server-computed snapshot. All three are optional;
  // null/0 preserves the legacy free-shipping behavior.
  shippingOptionId?: string | null;
  shippingOptionName?: string | null;
  shippingFeeInPaise?: bigint;
  // Phase 37 — buyer-picked B2B tax profile (CustomerTaxProfile.id).
  // Null/undefined preserves the legacy behaviour where tax-document.
  // service falls back to the customer's isDefault=true profile.
  selectedTaxProfileId?: string | null;
  // Phase 67 (2026-05-22) — deterministic idempotency key (audit
  // Gap #3). Service-computed from sha-256(customerId|
  // session.createdAt). When present, the repo INSERT collides
  // on the partial unique index for any retry firing past the
  // @Idempotent decorator's cache; the placeOrder service maps
  // the P2002 to a findFirst on the existing order so the retry
  // receives the original response shape.
  idempotencyKey?: string | null;
  // Phase 67 (audit Gap #9) — forensic linkage from order back to
  // the source cart row. Resolved by the service before the tx
  // (the cart is still live at that point); persisted at master
  // order create.
  sourceCartId?: string | null;
}

/**
 * Phase 67 (2026-05-22) — distinguishes "new order written" from
 * "idempotency-conflict resolved to existing order" so the service
 * can short-circuit the post-tx side-effects on a retry.
 */
export interface PlaceOrderTransactionResultIdempotent {
  reusedExistingOrder: boolean;
}

export interface PlaceOrderTransactionResult {
  orderNumber: string;
  masterOrderId: string;
  totalAmount: number;
  itemCount: number;
  createdSubOrders: CreatedSubOrderInfo[];
  cartCleared: boolean;
  // Phase 67 (2026-05-22) — audit Gap #3. True only when the repo
  // resolved an idempotency-key conflict and returned the existing
  // order's snapshot instead of writing a new one. The service uses
  // this to skip stock confirmation / wallet debit / Razorpay
  // create-order on retry — those side-effects are already
  // committed (or compensated) from the original placement.
  reusedExistingOrder?: boolean;
}

// ── Legacy order types ─────────────────────────────────────────────────────

export interface LegacyPlaceOrderTransactionResult {
  orderNumber: string;
  totalAmount: number;
  itemCount: number;
}

// ── Repository interface ───────────────────────────────────────────────────

export interface ICheckoutRepository {
  // ── Address operations ─────────────────────────────────────────────────
  findAddressByIdAndCustomer(addressId: string, customerId: string): Promise<CustomerAddressEntity | null>;
  findAddressesByCustomer(customerId: string): Promise<CustomerAddressEntity[]>;
  /**
   * Phase 63 (2026-05-22) — count of LIVE addresses for a customer.
   * Used by the service to enforce the per-customer cap (audit
   * Gap #12). deletedAt IS NULL is implied.
   */
  countLiveAddressesForCustomer(customerId: string): Promise<number>;
  /**
   * Phase 63 (2026-05-22) — soft delete (audit Gaps #2 + #3) +
   * promote-next-default in a single transaction. If the deleted
   * row was isDefault=true, the most-recently-created LIVE row is
   * flipped to isDefault=true so the customer always has a default
   * (when at least one address remains). Returns the promoted row
   * (or null if no successor) so the caller can audit it.
   */
  softDeleteAddressWithDefaultPromotion(
    addressId: string,
    customerId: string,
  ): Promise<{ promoted: CustomerAddressEntity | null }>;
  clearDefaultAddresses(customerId: string): Promise<void>;
  createAddress(input: CreateAddressInput): Promise<CustomerAddressEntity>;
  updateAddress(addressId: string, data: UpdateAddressInput): Promise<CustomerAddressEntity>;
  deleteAddress(addressId: string): Promise<void>;
  /**
   * Phase 63 (2026-05-22) — set-default now returns the previously-
   * default row alongside the new one so the UI can render a delta
   * without re-listing (audit Gap #22).
   */
  setDefaultAddress(
    addressId: string,
    customerId: string,
  ): Promise<{ previous: CustomerAddressEntity | null; current: CustomerAddressEntity }>;
  /**
   * Phase 63 (2026-05-22) — atomic create-with-default-flip (audit
   * Gap #1). Bundles the clearDefaultAddresses + createAddress
   * pair into one $transaction so two concurrent
   * isDefault=true creates can't both win. The partial unique
   * index added in the same migration is the DB-level backstop.
   */
  createAddressAtomic(
    input: CreateAddressInput,
  ): Promise<CustomerAddressEntity>;
  /**
   * Phase 63 — atomic update-with-default-flip (audit Gap #1).
   */
  updateAddressAtomic(
    addressId: string,
    customerId: string,
    data: UpdateAddressInput,
  ): Promise<CustomerAddressEntity>;

  // ── Cart operations ────────────────────────────────────────────────────
  findCartWithCheckoutItems(customerId: string): Promise<CartWithItems | null>;
  findCartWithLegacyItems(customerId: string): Promise<CartWithItems | null>;
  deleteCartItemsByIds(cartItemIds: string[]): Promise<void>;

  // ── Order operations ───────────────────────────────────────────────────
  placeOrderTransaction(input: PlaceOrderTransactionInput): Promise<PlaceOrderTransactionResult>;
  legacyPlaceOrderTransaction(
    customerId: string,
    cart: CartWithItems,
    addressSnapshot: Record<string, any>,
  ): Promise<LegacyPlaceOrderTransactionResult>;
  /**
   * Phase 67 (2026-05-22) — audit Gap #10. Stamps the seller
   * StockReservation id onto each OrderItem post-confirmation so
   * refund-by-item can resolve back without re-deriving the
   * (productId, variantId, mappingId) tuple. linkMap is
   * { orderItemId: stockReservationId }.
   */
  linkStockReservationsToOrderItems(
    masterOrderId: string,
    linkMap: Record<string, string>,
  ): Promise<void>;
  /**
   * Phase 67 (2026-05-22) — audit Gaps #1 + #5. Flips finalizedAt
   * once stock confirm + wallet debit + discount allocation + tax
   * snapshot + Razorpay create-order have all either committed or
   * been compensated. The recovery cron uses finalizedAt IS NULL
   * AND created_at < threshold as its scan predicate.
   */
  markOrderFinalized(masterOrderId: string): Promise<void>;
  /**
   * Phase 67 (2026-05-22) — audit Gap #3. Re-read after a partial-
   * unique-index conflict on idempotencyKey so the controller can
   * return the original placement's response shape.
   */
  findOrderByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PlaceOrderTransactionResult | null>;

  // ── Order queries ──────────────────────────────────────────────────────
  findMasterOrderWithSubOrders(orderNumber: string, customerId: string): Promise<MasterOrderEntity | null>;

  // ── Cancel operations ──────────────────────────────────────────────────
  cancelOrderTransaction(order: MasterOrderEntity): Promise<void>;
}
