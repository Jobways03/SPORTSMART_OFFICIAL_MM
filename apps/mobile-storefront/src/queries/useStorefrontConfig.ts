import {useQuery} from '@tanstack/react-query';
import {StorefrontConfig, configService} from '../services/config.service';
import {queryKeys} from './keys';

// Defaults the rest of the app falls back to when the config endpoint
// isn't reachable. Match the values previously hardcoded across
// CartScreen / HomeScreen so behaviour is identical pre-API.
const FALLBACK: Required<StorefrontConfig> = {
  freeShippingThreshold: 999,
  shippingFee: 49,
  gstRate: 0.18,
  membershipPriceYearly: 999,
  supportSlaHours: 4,
  flashSaleDurationHours: 8,
  currency: 'INR',
};

const CONFIG_STALE_MS = 60 * 60 * 1000; // 1h

export function useStorefrontConfig(): Required<StorefrontConfig> {
  const q = useQuery<StorefrontConfig>({
    queryKey: queryKeys.storefrontConfig(),
    queryFn: async () => {
      const res = await configService.get();
      return res.data ?? {};
    },
    staleTime: CONFIG_STALE_MS,
    retry: 0,
  });
  // Merge API → fallback so the returned object is always fully
  // populated. Consumers can use the values directly without
  // null-checking every field.
  return {...FALLBACK, ...(q.data ?? {})};
}
