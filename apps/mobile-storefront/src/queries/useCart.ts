import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {cartService, AddToCartPayload} from '../services/cart.service';
import {queryKeys} from './keys';

export function useCart() {
  return useQuery({
    queryKey: queryKeys.cart(),
    queryFn: async () => {
      const res = await cartService.getCart();
      return res.data ?? null;
    },
    // Cart can change on another device / via cross-tab actions, so
    // 10s staleTime keeps us closer to fresh while still avoiding a
    // refetch on every re-render. refetchOnMount: 'always' means tab
    // re-focus pulls a fresh cart even if the cache says it's fresh.
    staleTime: 10_000,
    refetchOnMount: 'always',
  });
}

export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddToCartPayload) => cartService.addItem(payload),
    onSuccess: () => {
      // Server is the source of truth post-add (price, stock, line-merges).
      // Invalidate rather than optimistic-update — keeps us honest on the
      // first cart fetch after add.
      qc.invalidateQueries({queryKey: queryKeys.cart()});
    },
  });
}
