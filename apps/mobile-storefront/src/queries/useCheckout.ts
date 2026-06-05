import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {checkoutService, PlaceOrderPayload} from '../services/checkout.service';
import {shippingService} from '../services/shipping.service';
import {queryKeys} from './keys';

export function useCheckoutInitiate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (addressId: string) => checkoutService.initiate(addressId),
    onSuccess: res => {
      if (res.data) qc.setQueryData(queryKeys.checkout(), res.data);
    },
  });
}

export function useCheckoutSummary(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.checkout(),
    queryFn: async () => {
      const res = await checkoutService.summary();
      return res.data ?? null;
    },
    enabled,
    // Checkout snapshot expires server-side; if you re-mount the screen
    // after a long pause, /summary will 410. Letting refetch happen on
    // mount means we surface that quickly.
    staleTime: 0,
  });
}

export function useRemoveUnserviceable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => checkoutService.removeUnserviceable(),
    onSuccess: res => {
      if (res.data) qc.setQueryData(queryKeys.checkout(), res.data);
      qc.invalidateQueries({queryKey: queryKeys.cart()});
    },
  });
}

export function useShippingQuote(netCartValueInPaise: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.shippingQuote(netCartValueInPaise),
    queryFn: async () => {
      const res = await shippingService.quote(netCartValueInPaise);
      return res.data ?? [];
    },
    enabled: enabled && netCartValueInPaise > 0,
  });
}

export function usePlaceOrder() {
  return useMutation({
    mutationFn: ({
      payload,
      idempotencyKey,
    }: {
      payload: PlaceOrderPayload;
      idempotencyKey: string;
    }) => checkoutService.placeOrder(payload, idempotencyKey),
  });
}

export function useRetryPayment() {
  return useMutation({
    mutationFn: (orderNumber: string) =>
      checkoutService.retryPayment(orderNumber),
  });
}

export function useVerifyPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: checkoutService.verifyPayment,
    onSuccess: () => {
      // After successful verify, server flips order status. Invalidate
      // orders so a navigation back into Orders sees fresh data, and
      // cart so the count badge clears.
      qc.invalidateQueries({queryKey: queryKeys.orders()});
      qc.invalidateQueries({queryKey: queryKeys.cart()});
    },
  });
}
