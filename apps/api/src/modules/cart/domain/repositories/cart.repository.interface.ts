export interface CartWithItems {
  id: string;
  customerId: string;
  items: CartItemWithDetails[];
}

export interface CartItemWithDetails {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  // Sprint 3 Story 2.3 — true when the item is parked, false when
  // it's in the active cart and counts toward order total.
  savedForLater: boolean;
  product: {
    id: string;
    title: string;
    slug: string;
    basePrice: any;
    baseStock: number | null;
    baseSku: string | null;
    hasVariants: boolean;
    status: string;
    images: { url: string }[];
  };
  variant: {
    id: string;
    title: string | null;
    price: any;
    stock: number | null;
    sku: string | null;
    status: string;
    images: { url: string }[];
  } | null;
}

export interface CartRepository {
  findByCustomerId(customerId: string): Promise<CartWithItems | null>;
  upsertCart(customerId: string): Promise<{ id: string }>;
  findCartItem(cartId: string, productId: string, variantId: string | null): Promise<{ id: string; quantity: number } | null>;
  addCartItem(cartId: string, productId: string, variantId: string | null, quantity: number): Promise<void>;
  updateCartItemQuantity(itemId: string, quantity: number): Promise<void>;
  deleteCartItem(itemId: string): Promise<void>;
  clearCart(cartId: string): Promise<void>;
  findCartByCustomerId(customerId: string): Promise<{ id: string } | null>;
  findCartItemById(itemId: string, cartId: string): Promise<{ id: string; productId: string; variantId: string | null; quantity: number } | null>;
  getAggregatedStock(productId: string, variantId?: string | null): Promise<number>;
  validateProduct(productId: string): Promise<boolean>;
  validateVariant(variantId: string, productId: string): Promise<boolean>;
  /** Count cart items currently referencing a given variant. Used to block
   *  catalog admins from soft-deleting variants that customers have in their
   *  carts (would otherwise crash checkout with a NULL variant reference). */
  countActiveItemsForVariant(variantId: string): Promise<number>;
  /** Same, but for a base-product (no variant) line item. */
  countActiveItemsForProduct(productId: string): Promise<number>;
  /**
   * Phase 1 (PR 1.9) — atomic add primitive.
   *
   * Find-or-update-or-create a cart_items row for
   * (cartId, productId, variantId) in a single transaction. Implementations
   * MUST hold a row-level lock on the cart row for the duration of the
   * find+write so two concurrent calls for the same key serialise and
   * the second sees the first's row (and increments quantity) instead
   * of producing a duplicate line.
   *
   * Why a method-level primitive instead of a transaction in the
   * service: the lock target (`SELECT ... FOR UPDATE`) is a SQL detail
   * the service shouldn't know about. The repo owns the storage
   * mechanics; the service stays at the "merge this quantity into the
   * cart" level.
   */
  incrementOrCreateCartItem(
    cartId: string,
    productId: string,
    variantId: string | null,
    quantityDelta: number,
  ): Promise<void>;

  /** Sprint 3 Story 2.3 — set the saved-for-later flag on a cart item.
   *  Idempotent. Caller is responsible for verifying the item belongs
   *  to the requesting customer. */
  setSavedForLater(itemId: string, value: boolean): Promise<void>;
}

export const CART_REPOSITORY = Symbol('CartRepository');
