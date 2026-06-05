import {useQuery} from '@tanstack/react-query';
import {statsService, StorefrontStats} from '../services/stats.service';
import {queryKeys} from './keys';

// Stats are slow-moving (athlete counts, brand counts, store counts)
// so a long staleTime keeps us off the API while the user browses.
// 30 minutes is a balance between freshness and chatter.
const STATS_STALE_MS = 30 * 60 * 1000;

export function useStorefrontStats() {
  return useQuery<StorefrontStats>({
    queryKey: queryKeys.storefrontStats(),
    queryFn: async () => {
      const res = await statsService.getStorefrontStats();
      // Endpoint may not exist yet. Return an empty object so the
      // consumer falls back to its hardcoded baseline rather than
      // surfacing an error toast for a non-critical screen.
      return res.data ?? {};
    },
    staleTime: STATS_STALE_MS,
    retry: 0,
  });
}
