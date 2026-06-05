import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  addressesService,
  AddressPayload,
  UpdateAddressPayload,
} from '../services/addresses.service';
import {queryKeys} from './keys';

export function useAddresses() {
  return useQuery({
    queryKey: queryKeys.addresses(),
    queryFn: async () => {
      const res = await addressesService.list();
      return res.data ?? [];
    },
  });
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddressPayload) => addressesService.create(payload),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.addresses()}),
  });
}

export function useUpdateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({id, payload}: {id: string; payload: UpdateAddressPayload}) =>
      addressesService.update(id, payload),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.addresses()}),
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => addressesService.remove(id),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.addresses()}),
  });
}

export function useSetDefaultAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => addressesService.setDefault(id),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.addresses()}),
  });
}
