import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  supportService,
  CreateTicketPayload,
} from '../services/support.service';
import {queryKeys} from './keys';

export function useTicketCategories() {
  return useQuery({
    queryKey: queryKeys.ticketCategories(),
    queryFn: async () => {
      const res = await supportService.listCategories();
      return res.data ?? [];
    },
    // Categories rarely change — keep them around so the create-ticket
    // form loads instantly on second open.
    staleTime: 10 * 60_000,
  });
}

export function useTickets() {
  return useQuery({
    queryKey: queryKeys.tickets(),
    queryFn: async () => {
      const res = await supportService.listMyTickets(1, 50);
      return res.data ?? {items: [], page: 1, limit: 50, total: 0};
    },
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ticket(id ?? ''),
    queryFn: async () => {
      if (!id) return null;
      const res = await supportService.getTicket(id);
      return res.data ?? null;
    },
    enabled: !!id,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTicketPayload) =>
      supportService.createTicket(payload),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.tickets()}),
  });
}

export function useReplyToTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ticketId, body}: {ticketId: string; body: string}) =>
      supportService.reply(ticketId, body),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({queryKey: queryKeys.ticket(vars.ticketId)});
      qc.invalidateQueries({queryKey: queryKeys.tickets()});
    },
  });
}

export function useCloseTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) => supportService.closeTicket(ticketId),
    onSuccess: (_res, ticketId) => {
      qc.invalidateQueries({queryKey: queryKeys.ticket(ticketId)});
      qc.invalidateQueries({queryKey: queryKeys.tickets()});
    },
  });
}
