import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors the backend WishlistItem wire shape from
// apps/api/src/modules/wishlist/. Phase 202 (#12) — the API no longer
// leaks internal product/variant `status` columns; it exposes a computed
// `available` boolean and suppresses the live price for unavailable rows.
// Money is a string in paise (#13/#14) — coerce with Number() only at the
// format boundary.
export interface WishlistItem {
  id: string;
  productId: string;
  variantId: string | null;
  note: string | null;
  createdAt: string;
  // #3/#12 — true only when the product (+ pinned variant) is live,
  // approved and not soft-deleted. The FE hides the price + disables
  // move-to-cart when false.
  available: boolean;
  product: {
    id: string;
    title: string;
    slug: string;
    brand: { id: string; name: string } | null;
    imageUrl: string | null;
    imageAlt: string | null;
  };
  variant: {
    id: string;
    sku: string | null;
  } | null;
  // Live price in integer paise, serialized as a string. Null when the
  // item is unavailable.
  priceInPaise: string | null;
  // Add-time price snapshot in integer paise (string). Lets the UI show
  // "price changed since you saved this".
  unitPriceInPaiseAtAdd: string | null;
}

export interface WishlistListResponse {
  items: WishlistItem[];
  total: number;
  page: number;
  limit: number;
}

// Phase 202 (#8) — id-only projection the catalog/PDP fetch once on
// mount to seed every heart's filled/empty state.
export interface WishlistIdsResponse {
  productIds: string[];
  variantPairs: { productId: string; variantId: string }[];
}

export interface AddToWishlistPayload {
  productId: string;
  variantId?: string;
  note?: string;
}

export const wishlistService = {
  list(page = 1, limit = 50): Promise<ApiResponse<WishlistListResponse>> {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    return apiClient<WishlistListResponse>(`/customer/wishlist?${qs.toString()}`);
  },

  // #8 — seed wishlist state on catalog/PDP mount.
  ids(): Promise<ApiResponse<WishlistIdsResponse>> {
    return apiClient<WishlistIdsResponse>('/customer/wishlist/ids');
  },

  add(payload: AddToWishlistPayload): Promise<ApiResponse<WishlistItem>> {
    return apiClient<WishlistItem>('/customer/wishlist', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  remove(itemId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/customer/wishlist/${itemId}`, {
      method: 'DELETE',
    });
  },

  // #7 — backend move-to-cart (re-validates + removes the wishlist row).
  // The caller performs the actual cart insert via the cart endpoint.
  moveToCart(
    itemId: string,
  ): Promise<ApiResponse<{ productId: string; variantId: string | null; quantity: number }>> {
    return apiClient(`/customer/wishlist/${itemId}/move-to-cart`, {
      method: 'POST',
    });
  },
};
