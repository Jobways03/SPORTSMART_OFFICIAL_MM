import {useQuery} from '@tanstack/react-query';
import {filtersService, FiltersQuery} from '../services/filters.service';
import {queryKeys} from './keys';

// Key serializes the active-filter context so faceted counts re-compute
// when the user selects/deselects values from another group.
function filtersKey(query: FiltersQuery): string {
  return JSON.stringify({
    categoryId: query.categoryId,
    collectionId: query.collectionId,
    search: query.search,
    activeFilters: query.activeFilters,
  });
}

export function useFilters(query: FiltersQuery = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.filters(filtersKey(query)),
    queryFn: async () => {
      const res = await filtersService.list(query);
      return res.data?.filters ?? [];
    },
    enabled,
    // Filter facets change rarely outside of stock movements / new
    // products. 60s staleTime keeps the sheet snappy.
    staleTime: 60_000,
  });
}
