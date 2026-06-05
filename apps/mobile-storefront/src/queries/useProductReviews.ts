import {useQuery} from '@tanstack/react-query';
import {
  ProductReviewsResponse,
  productReviewsService,
} from '../services/product-reviews.service';
import {queryKeys} from './keys';

const REVIEWS_STALE_MS = 5 * 60 * 1000;

// Returns null when the backend has no reviews or the endpoint is
// missing. ProductDetailScreen hides the entire reviews section in
// that case, instead of showing fake placeholder ratings.
export function useProductReviews(productSlug: string | undefined) {
  return useQuery<ProductReviewsResponse | null>({
    queryKey: queryKeys.productReviews(productSlug ?? ''),
    queryFn: async () => {
      if (!productSlug) return null;
      const res = await productReviewsService.list(productSlug);
      return res.data ?? null;
    },
    enabled: !!productSlug,
    staleTime: REVIEWS_STALE_MS,
    retry: 0,
  });
}
