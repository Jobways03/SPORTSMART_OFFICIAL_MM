import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors the backend WishlistItem shape from
// apps/api/src/modules/wishlist/. The list response embeds enough
// product / variant info to render a card without a second roundtrip.
export interface WishlistItem {
  id: string;
  productId: string;
  variantId: string | null;
  note: string | null;
  createdAt: string;
  product: {
    id: string;
    title: string;
    slug: string;
    basePrice: string | number | null;
    status: string;
  };
  variant: {
    id: string;
    sku: string | null;
    price: string | number | null;
    status: string;
  } | null;
}

export interface WishlistListResponse {
  items: WishlistItem[];
  total: number;
  page: number;
  limit: number;
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
};
