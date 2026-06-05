import {useQuery} from '@tanstack/react-query';
import {accessHistoryService} from '../services/access-history.service';
import {queryKeys} from './keys';

export function useAccessHistory() {
  return useQuery({
    queryKey: queryKeys.accessHistory(),
    queryFn: async () => {
      const res = await accessHistoryService.list(50);
      return res.data?.items ?? [];
    },
    staleTime: 30_000,
  });
}
