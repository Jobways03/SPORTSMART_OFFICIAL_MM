import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors apps/api/src/modules/content/storefront-content/
// storefront-content.service.ts → StorefrontContentBlockDto.
// The backend operates by slot (not id), so this client uses slot
// as the path parameter for upsert / reset / upload.
export interface StorefrontContentBlock {
  slot: string;
  imageUrl: string | null;
  eyebrow: string | null;
  headline: string | null;
  subhead: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  price: string | null;
  priceCaption: string | null;
  active: boolean;
  updatedAt: string;
}

export interface UpsertStorefrontContentInput {
  imageUrl?: string | null;
  eyebrow?: string | null;
  headline?: string | null;
  subhead?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  price?: string | null;
  priceCaption?: string | null;
  active?: boolean;
}

export interface StorefrontContentListResponse {
  items: StorefrontContentBlock[];
}

export const adminStorefrontContentService = {
  list(): Promise<ApiResponse<StorefrontContentListResponse>> {
    return apiClient<StorefrontContentListResponse>('/admin/storefront-content');
  },

  getOne(slot: string): Promise<ApiResponse<StorefrontContentBlock | null>> {
    return apiClient<StorefrontContentBlock | null>(
      `/admin/storefront-content/${encodeURIComponent(slot)}`,
    );
  },

  // PUT is idempotent — same payload twice produces the same state.
  upsert(
    slot: string,
    input: UpsertStorefrontContentInput,
  ): Promise<ApiResponse<StorefrontContentBlock>> {
    return apiClient<StorefrontContentBlock>(
      `/admin/storefront-content/${encodeURIComponent(slot)}`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
    );
  },

  // Resets the slot to the storefront's curated fallback by deleting
  // the row. Mobile sections then hide (or show their own fallback)
  // depending on the consumer.
  reset(slot: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/storefront-content/${encodeURIComponent(slot)}`, {
      method: 'DELETE',
    });
  },
};
