import {useQuery} from '@tanstack/react-query';
import {customerTaxService} from '../services/customer-tax.service';
import {queryKeys} from './keys';

export function useInvoices(orderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.invoices(orderId ?? ''),
    queryFn: async () => {
      if (!orderId) return {items: []};
      const res = await customerTaxService.list({orderId, limit: 20});
      return res.data ?? {items: []};
    },
    enabled: !!orderId,
    // Invoices generate async after order placement — poll-on-mount is
    // good enough; user can pull-to-refresh OrderDetail to retry.
    staleTime: 30_000,
  });
}

// Account-level "all my invoices" view (not scoped to a single order).
// Mirrors the web storefront's /account/invoices page.
export function useAllInvoices() {
  return useQuery({
    queryKey: queryKeys.invoices('all'),
    queryFn: async () => {
      const res = await customerTaxService.list({limit: 50});
      return res.data ?? {items: []};
    },
    staleTime: 30_000,
  });
}
