import {useQuery} from '@tanstack/react-query';
import {
  BrandRef,
  CategoryRef,
  CollectionRef,
  catalogService,
} from '../services/catalog.service';
import {queryKeys} from './keys';

// Reference data is slow-moving (categories, brands, curated
// collections rarely change within a session) so a long staleTime
// keeps these off the network during normal browsing.
const REFS_STALE_MS = 15 * 60 * 1000;

// Backend returns categories as a tree (parents with nested children).
// HomeScreen + BrowseScreen want a flat list — only top-level for the
// home rail, but the full tree flattened for search/pills. Flattening
// here means consumers don't need to recurse themselves.
function flatten(nodes: CategoryRef[]): CategoryRef[] {
  const out: CategoryRef[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children && n.children.length > 0) {
      out.push(...flatten(n.children));
    }
  }
  return out;
}

export function useCategories() {
  return useQuery<CategoryRef[]>({
    queryKey: queryKeys.categories(),
    queryFn: async () => {
      const res = await catalogService.listCategories();
      // Backend wraps the tree in {success, message, data: [...]}. We
      // care about top-level categories for the home/browse rails;
      // children are available on each node if a screen needs them.
      return res.data ?? [];
    },
    staleTime: REFS_STALE_MS,
    retry: 0,
  });
}

// Variant of useCategories that returns every node (root + descendants)
// flattened into a single array. Useful for search-style pickers.
export function useCategoriesFlat() {
  return useQuery<CategoryRef[]>({
    queryKey: [...queryKeys.categories(), 'flat'] as const,
    queryFn: async () => {
      const res = await catalogService.listCategories();
      return flatten(res.data ?? []);
    },
    staleTime: REFS_STALE_MS,
    retry: 0,
  });
}

export function useBrands() {
  return useQuery<BrandRef[]>({
    queryKey: queryKeys.brands(),
    queryFn: async () => {
      const res = await catalogService.listBrands();
      return res.data ?? [];
    },
    staleTime: REFS_STALE_MS,
    retry: 0,
  });
}

export function useCollections() {
  return useQuery<CollectionRef[]>({
    queryKey: queryKeys.collections(),
    queryFn: async () => {
      const res = await catalogService.listCollections();
      return res.data ?? [];
    },
    staleTime: REFS_STALE_MS,
    retry: 0,
  });
}
