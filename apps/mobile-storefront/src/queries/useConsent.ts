import {useQuery} from '@tanstack/react-query';
import {consentService} from '../services/consent.service';
import {queryKeys} from './keys';

export function useConsent() {
  return useQuery({
    queryKey: queryKeys.consent(),
    queryFn: async () => {
      const res = await consentService.get();
      return res.data ?? {};
    },
    staleTime: 60_000,
  });
}
