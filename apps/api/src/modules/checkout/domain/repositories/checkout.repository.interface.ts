// ── Checkout Repository Interface ─────────────────────────────────────────
// Domain contract — no framework or Prisma references leak into this layer.

export const CHECKOUT_REPOSITORY = Symbol('CHECKOUT_REPOSITORY');

// ── Address types ──────────────────────────────────────────────────────────

export interface CustomerAddressEntity {
  id: string;
  customerId: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
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
  city: string;
  state: string;
  // Phase 34 — optional canonical CBIC 2-digit GST state code. When
  // omitted, the repository resolves it by name against india_states
  // at write time. Passing an explicit value (e.g. from a future UI
  // that selects from a dropdown) skips the lookup.
  stateCode?: string | null;
  postalCode: string;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  fullName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  locality?: string | null;
  city?: string;
  state?: string;
  // Phase 34 — when `state` is updated, the repository re-resolves
  // stateCode from india_states. Explicit `stateCode` overrides.
  stateCode?: string | null;
  postalCode?: string;
  isDefault?: boolean;
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
  affiliateAttribution?: {
    affiliateId: string;
    source: 'LINK' | 'COUPON';
    code: string;
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
}

export interface PlaceOrderTransactionResult {
  orderNumber: string;
  masterOrderId: string;
  totalAmount: number;
  itemCount: number;
  createdSubOrders: CreatedSubOrderInfo[];
  cartCleared: boolean;
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
  clearDefaultAddresses(customerId: string): Promise<void>;
  createAddress(input: CreateAddressInput): Promise<CustomerAddressEntity>;
  updateAddress(addressId: string, data: UpdateAddressInput): Promise<CustomerAddressEntity>;
  deleteAddress(addressId: string): Promise<void>;
  setDefaultAddress(addressId: string, customerId: string): Promise<CustomerAddressEntity>;

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

  // ── Order queries ──────────────────────────────────────────────────────
  findMasterOrderWithSubOrders(orderNumber: string, customerId: string): Promise<MasterOrderEntity | null>;

  // ── Cancel operations ──────────────────────────────────────────────────
  cancelOrderTransaction(order: MasterOrderEntity): Promise<void>;
}
