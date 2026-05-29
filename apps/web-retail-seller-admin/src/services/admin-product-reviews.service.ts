import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors apps/api/src/modules/product-reviews/product-reviews.service.ts
// AdminReviewDto. Kept manually in sync — the moderation page reads
// these fields, so any drift surfaces as a typecheck error.
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ProductReview {
  id: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  userEmail: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  verifiedBuyer: boolean;
  moderatedAt: string | null;
  moderatedById: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductReviewListResponse {
  items: ProductReview[];
  total: number;
  page: number;
  limit: number;
}

export interface ListReviewsParams {
  page?: number;
  limit?: number;
  status?: ReviewStatus;
  productSlug?: string;
}

export const adminProductReviewsService = {
  list(
    params: ListReviewsParams = {},
  ): Promise<ApiResponse<ProductReviewListResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    if (params.productSlug) qs.set('productSlug', params.productSlug);
    const s = qs.toString();
    return apiClient<ProductReviewListResponse>(
      `/admin/product-reviews${s ? `?${s}` : ''}`,
    );
  },

  approve(id: string): Promise<ApiResponse<ProductReview>> {
    return apiClient<ProductReview>(`/admin/product-reviews/${id}/approve`, {
      method: 'POST',
    });
  },

  reject(
    id: string,
    reason: string | undefined,
  ): Promise<ApiResponse<ProductReview>> {
    return apiClient<ProductReview>(`/admin/product-reviews/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  remove(id: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/product-reviews/${id}`, { method: 'DELETE' });
  },
};
