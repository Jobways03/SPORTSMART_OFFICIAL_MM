import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  returnsService,
  CreateReturnPayload,
} from '../services/returns.service';
import {queryKeys} from './keys';

export function useReturns() {
  return useQuery({
    queryKey: queryKeys.returns(),
    queryFn: async () => {
      const res = await returnsService.list(1, 50);
      return (
        res.data ?? {
          returns: [],
          pagination: {page: 1, limit: 50, total: 0, totalPages: 0},
        }
      );
    },
  });
}

export function useReturnDetail(returnId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.return(returnId ?? ''),
    queryFn: async () => {
      if (!returnId) return null;
      const res = await returnsService.get(returnId);
      return res.data ?? null;
    },
    enabled: !!returnId,
  });
}

export function useCancelReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (returnId: string) => returnsService.cancel(returnId),
    onSuccess: (_res, returnId) => {
      qc.invalidateQueries({queryKey: queryKeys.return(returnId)});
      qc.invalidateQueries({queryKey: queryKeys.returns()});
    },
  });
}

export function useReturnEligibility(masterOrderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.returnEligibility(masterOrderId ?? ''),
    queryFn: async () => {
      if (!masterOrderId) return null;
      const res = await returnsService.checkEligibility(masterOrderId);
      return res.data ?? null;
    },
    enabled: !!masterOrderId,
  });
}

export function useCreateReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateReturnPayload) => returnsService.create(payload),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.returns()}),
  });
}

export function useMarkReturnHandedOver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (returnId: string) => returnsService.markHandedOver(returnId),
    onSuccess: (_res, returnId) => {
      qc.invalidateQueries({queryKey: queryKeys.return(returnId)});
      qc.invalidateQueries({queryKey: queryKeys.returns()});
    },
  });
}
