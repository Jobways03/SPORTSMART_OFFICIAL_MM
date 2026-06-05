import {apiClient, ApiResponse} from '../lib/api-client';

// Field names mirror the GET /customer/cart response exactly. The API
// returns the item image as `imageUrl` and the cart total as
// `totalAmount` — these were previously mis-named (`primaryImageUrl`,
// `subtotal`), so they read as undefined → blank thumbnails and ₹0
// totals (the "₹999 away / 0%" free-shipping bug).
export interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
}

export interface Cart {
  items: CartItem[];
  itemCount: number;
  totalAmount: number;
}

export interface AddToCartPayload {
  productId: string;
  variantId?: string;
  quantity: number;
}

export const cartService = {
  getCart(): Promise<ApiResponse<Cart>> {
    return apiClient<Cart>('/customer/cart');
  },

  // The mutation endpoints below intentionally return ApiResponse<void>.
  // Backend responses are {success, message} with no data field —
  // the caller relies on query invalidation (useAddToCart etc.) to
  // pull a fresh Cart on the next render. Lying about the return type
  // here would silently break a hypothetical caller that read res.data.
  addItem(payload: AddToCartPayload): Promise<ApiResponse<void>> {
    return apiClient<void>('/customer/cart/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateItem(itemId: string, quantity: number): Promise<ApiResponse<void>> {
    return apiClient<void>(`/customer/cart/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({quantity}),
    });
  },

  removeItem(itemId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/customer/cart/items/${itemId}`, {
      method: 'DELETE',
    });
  },
};
