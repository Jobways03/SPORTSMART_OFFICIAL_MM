import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {catalogService, ProductsQuery} from '../services/catalog.service';
import {queryKeys} from './keys';

export function useProducts(query: ProductsQuery = {}) {
  return useQuery({
    queryKey: queryKeys.products(query),
    queryFn: async () => {
      const res = await catalogService.listProducts(query);
      return (
        res.data ?? {
          products: [],
          pagination: {page: 1, limit: 0, total: 0, totalPages: 0},
        }
      );
    },
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.product(slug ?? ''),
    queryFn: async () => {
      if (!slug) return null;
      const res = await catalogService.getProductBySlug(slug);
      return res.data ?? null;
    },
    enabled: !!slug,
  });
}

/**
 * Infinite-scrolling product list backing BrowseScreen's FlatList. Pages
 * are concatenated server-side via pagination.page; onEndReached calls
 * fetchNextPage when more pages exist.
 */
export function useInfiniteProducts(
  query: Omit<ProductsQuery, 'page'> = {},
  pageSize = 20,
) {
  return useInfiniteQuery({
    queryKey: queryKeys.productsInfinite({...query, limit: pageSize}),
    queryFn: async ({pageParam}) => {
      const res = await catalogService.listProducts({
        ...query,
        page: pageParam,
        limit: pageSize,
      });
      return (
        res.data ?? {
          products: [],
          pagination: {
            page: pageParam,
            limit: pageSize,
            total: 0,
            totalPages: 0,
          },
        }
      );
    },
    initialPageParam: 1,
    getNextPageParam: lastPage => {
      const {page, totalPages} = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
  });
}
