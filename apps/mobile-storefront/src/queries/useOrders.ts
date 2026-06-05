import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {ordersService} from '../services/orders.service';
import {queryKeys} from './keys';

export function useOrders() {
  return useQuery({
    queryKey: queryKeys.orders(),
    queryFn: async () => {
      const res = await ordersService.list(1, 50);
      return (
        res.data ?? {
          orders: [],
          pagination: {page: 1, total: 0, totalPages: 0},
        }
      );
    },
  });
}

export function useOrder(orderNumber: string | undefined) {
  return useQuery({
    queryKey: queryKeys.order(orderNumber ?? ''),
    queryFn: async () => {
      if (!orderNumber) return null;
      const res = await ordersService.get(orderNumber);
      return res.data ?? null;
    },
    enabled: !!orderNumber,
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderNumber: string) => ordersService.cancel(orderNumber),
    onSuccess: (_res, orderNumber) => {
      qc.invalidateQueries({queryKey: queryKeys.order(orderNumber)});
      qc.invalidateQueries({queryKey: queryKeys.orders()});
    },
  });
}
