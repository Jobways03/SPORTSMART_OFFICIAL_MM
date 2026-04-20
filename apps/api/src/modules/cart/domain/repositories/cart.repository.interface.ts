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
  product: {
    id: string;
    title: string;
    slug: string;
    basePrice: any;
    platformPrice: any;
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
    platformPrice: any;
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
}

export const CART_REPOSITORY = Symbol('CartRepository');
