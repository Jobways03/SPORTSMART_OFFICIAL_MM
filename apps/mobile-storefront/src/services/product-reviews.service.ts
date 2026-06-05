import {apiClient, ApiResponse} from '../lib/api-client';

// Per-product reviews shown on the ProductDetailScreen. Distinct
// from `testimonials.service` — testimonials are curated brand-level
// content; these are user-generated, tied to a specific product.

export interface ProductReview {
  id: string;
  authorName: string;
  rating: number;
  title?: string;
  body: string;
  createdAt: string;
  verifiedBuyer?: boolean;
}

export interface ProductReviewSummary {
  averageRating: number;
  reviewCount: number;
  /** Stars → fraction (0..1). Keys 1..5. */
  ratingBreakdown: Record<string, number>;
}

export interface ProductReviewsResponse {
  summary: ProductReviewSummary;
  reviews: ProductReview[];
}

export const productReviewsService = {
  list(productSlug: string): Promise<ApiResponse<ProductReviewsResponse>> {
    return apiClient<ProductReviewsResponse>(
      `/storefront/products/${productSlug}/reviews`,
    );
  },
};
