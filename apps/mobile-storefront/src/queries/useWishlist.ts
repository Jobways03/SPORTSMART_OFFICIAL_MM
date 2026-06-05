import {useMemo} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  wishlistService,
  AddToWishlistPayload,
  WishlistItem,
} from '../services/wishlist.service';
import {queryKeys} from './keys';

export function useWishlist() {
  return useQuery({
    queryKey: queryKeys.wishlist(),
    queryFn: async () => {
      const res = await wishlistService.list(1, 100);
      return res.data ?? {items: [], total: 0, page: 1, limit: 100};
    },
  });
}

/**
 * Maps productId → wishlistItemId for O(1) lookups by PDP / grid cards.
 * Returns undefined when the wishlist hasn't loaded yet.
 */
export function useWishlistLookup() {
  const query = useWishlist();
  return useMemo(() => {
    if (!query.data) return null;
    const map = new Map<string, string>();
    for (const item of query.data.items) {
      map.set(item.productId, item.id);
    }
    return map;
  }, [query.data]);
}

export function useAddToWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddToWishlistPayload) => wishlistService.add(payload),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.wishlist()}),
  });
}

export function useRemoveFromWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => wishlistService.remove(itemId),
    onMutate: async (itemId: string) => {
      // Optimistic remove — the wishlist screen feels snappier when the row
      // disappears immediately instead of after the round-trip.
      await qc.cancelQueries({queryKey: queryKeys.wishlist()});
      const prev = qc.getQueryData<{items: WishlistItem[]}>(queryKeys.wishlist());
      if (prev) {
        qc.setQueryData(queryKeys.wishlist(), {
          ...prev,
          items: prev.items.filter(i => i.id !== itemId),
        });
      }
      return {prev};
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.wishlist(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({queryKey: queryKeys.wishlist()}),
  });
}
