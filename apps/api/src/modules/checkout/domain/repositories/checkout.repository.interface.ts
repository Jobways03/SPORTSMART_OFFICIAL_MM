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
