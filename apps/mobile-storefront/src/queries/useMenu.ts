import {useQuery} from '@tanstack/react-query';
import {fetchMenu} from '../services/menu.service';
import {queryKeys} from './keys';

export function useMenu(handle: string) {
  return useQuery({
    queryKey: queryKeys.menu(handle),
    queryFn: () => fetchMenu(handle),
    // Menu is admin-editable but rarely changes — 5 min keeps it fresh
    // enough without thrashing the API on every screen mount.
    staleTime: 5 * 60_000,
  });
}
