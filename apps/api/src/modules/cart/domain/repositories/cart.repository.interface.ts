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
  // Phase 61 (2026-05-22) — add-time snapshot in paise (audit
  // Gap #22). The cart service reads this to surface a
  // `priceChanged` flag when the live price drifts from the
  // snapshot.
  unitPriceAtAddInPaise: bigint | null;
  product: {
    id: string;
    title: string;
    slug: string;
    basePrice: any;
    baseStock: number | null;
    baseSku: string | null;
    hasVariants: boolean;
    status: string;
    isDeleted: boolean;
    images: { url: string }[];
    // Phase 61 (2026-05-22) — seller shop info threaded through so
    // the storefront cart can group line items by seller without a
    // second API call (audit Gap #2).
    seller: { id: string; sellerName: string | null; sellerShopName: string | null } | null;
  };
  variant: {
    id: string;
    title: string | null;
    price: any;
    stock: number | null;
    sku: string | null;
    status: string;
    isDeleted: boolean;
    images: { url: string }[];
  } | null;
}

// Phase 37 — narrow shape consumed by the tax module's cart-side
// preview. Includes sellerId (not in CartWithItems) which the tax
// engine needs for place-of-supply resolution.
export interface CartItemForTaxPreview {
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Per-unit price in paise, derived from variant.price ?? product.basePrice. */
  unitPriceInPaise: bigint;
  /** Seller fulfilling this product (null for platform-owned). */
  sellerId: string | null;
}

export interface CartRepository {
  findByCustomerId(customerId: string): Promise<CartWithItems | null>;
  /**
   * Phase 37 — minimal cart projection for the tax module's cart-side
   * preview. Filters out save-for-later items. Used by the
   * CartPublicFacade only — internal cart code keeps using
   * findByCustomerId for the rich UI shape.
   */
  findItemsForTaxPreview(customerId: string): Promise<CartItemForTaxPreview[]>;
  upsertCart(customerId: string): Promise<{ id: string }>;
  /** Phase 196 (#11) — refresh Cart.lastActivityAt after a non-add mutation. */
  touchLastActivity(cartId: string): Promise<void>;
  findCartItem(cartId: string, productId: string, variantId: string | null): Promise<{ id: string; quantity: number } | null>;
  // Phase 196 (#16) — quantity set under the cart-row lock with an in-lock
  // stock re-check (was a bare update after a non-transactional read).
  updateCartItemQuantity(itemId: string, cartId: string, productId: string, variantId: string | null, quantity: number): Promise<void>;
  deleteCartItem(itemId: string): Promise<void>;
  clearCart(cartId: string): Promise<void>;
  findCartByCustomerId(customerId: string): Promise<{ id: string } | null>;
  findCartItemById(itemId: string, cartId: string): Promise<{ id: string; productId: string; variantId: string | null; quantity: number } | null>;
  getAggregatedStock(productId: string, variantId?: string | null): Promise<number>;
  /** Phase 196 (#10) — batched stock aggregate; map keyed `${productId}:${variantId ?? 'null'}`. */
  getAggregatedStockBatch(keys: Array<{ productId: string; variantId: string | null }>): Promise<Map<string, number>>;
  validateProduct(productId: string): Promise<boolean>;
  validateVariant(variantId: string, productId: string): Promise<boolean>;
  /**
   * Phase 61 (2026-05-22) — count of active + saved cart-item rows
   * for a given customer's cart (audit Gap #23). Used by the
   * service to enforce the per-cart line cap so a hostile authed
   * user can't grow a cart to thousands of lines.
   */
  countCartItemsForCustomer(customerId: string): Promise<number>;
  /**
   * Phase 61 (2026-05-22) — abandonment-cleanup helper (audit Gap
   * #12). Deletes Cart rows whose updatedAt is older than `cutoff`
   * AND that have no items (or only items also older than `cutoff`).
   * Returns the number of carts deleted. Idempotent — running
   * twice in a row is a no-op the second time.
   */
  deleteAbandonedCartsOlderThan(cutoff: Date): Promise<number>;
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
  /**
   * Phase 61 (2026-05-22) — primitive signature extended:
   *   - `availableStock` lets the repo enforce the stock floor
   *     INSIDE the FOR UPDATE lock (audit Gap #7). Pre-Phase-61
   *     the service computed existingQty + availableStock outside
   *     the lock; two parallel adds could both pass the check
   *     before either incremented.
   *   - `unitPriceInPaiseSnapshot` is written on the create branch
   *     so the row carries the add-time price for drift detection
   *     (audit Gap #22). Snap-back from saved-for-later re-uses
   *     the existing snapshot if present.
   *
   * Throws `StockBelowReservedError`-style typed errors via plain
   * `Error` with `code='INSUFFICIENT_STOCK'` so the service maps
   * it to a clean 400. Throws `code='CART_LINE_CAP'` when the
   * per-cart line cap is hit on a fresh row (existing-row
   * increments aren't blocked).
   */
  incrementOrCreateCartItem(
    cartId: string,
    productId: string,
    variantId: string | null,
    quantityDelta: number,
    args: {
      availableStock: number;
      unitPriceInPaiseSnapshot: bigint;
      cartLineCap: number;
    },
  ): Promise<void>;

  /** Sprint 3 Story 2.3 — set the saved-for-later flag on a cart item.
   *  Idempotent. Caller is responsible for verifying the item belongs
   *  to the requesting customer. */
  setSavedForLater(itemId: string, value: boolean): Promise<void>;

  /**
   * Live list unit price in paise for (product, variant) —
   * variant.price when a variant is given, product.basePrice
   * otherwise. Used by addItem for the add-time price snapshot
   * (audit Gap #22).
   */
  getListUnitPriceInPaise(
    productId: string,
    variantId: string | null,
  ): Promise<bigint>;

  /**
   * Phase 4.1 (2026-05-16) — atomic move-to-cart with stock check.
   *
   * Inside a single transaction:
   *   1. Read aggregated available stock for (productId, variantId).
   *   2. If stock < quantity → return { moved: false, availableStock }.
   *   3. Else flip savedForLater=false and return { moved: true }.
   *
   * Concurrency: by serialising the check+flip the repo guarantees a
   * parallel reservation cannot consume stock between the two
   * operations. The service layer surfaces a clean 400 when moved=false.
   */
  moveToCartIfStockAvailable(
    itemId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
  ): Promise<{ moved: boolean; availableStock: number }>;
}

export const CART_REPOSITORY = Symbol('CartRepository');
