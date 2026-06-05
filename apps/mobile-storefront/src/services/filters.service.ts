import {apiClient, ApiResponse} from '../lib/api-client';

// Mirrors the FilterGroup shape served by /api/v1/storefront/filters.
// See apps/api/src/modules/catalog/presentation/controllers/public/
// storefront-filters.controller.ts for the source of truth.

export interface FilterValue {
  value: string;
  label: string;
  count: number;
  colorHex?: string;
}

export interface FilterGroup {
  key: string;
  label: string;
  type: string;
  builtIn: boolean;
  definitionId?: string;
  collapsed: boolean;
  showCounts: boolean;
  values?: FilterValue[];
  range?: {min: number; max: number};
  counts?: {true: number; false: number};
}

export interface FiltersQuery {
  categoryId?: string;
  collectionId?: string;
  search?: string;
  /** Currently-active filters so the API can compute faceted counts
   *  that reflect what would be selectable given other selections. */
  activeFilters?: Record<string, string[]>;
}

export const filtersService = {
  list(query: FiltersQuery = {}): Promise<ApiResponse<{filters: FilterGroup[]}>> {
    const params = new URLSearchParams();
    if (query.categoryId) params.set('categoryId', query.categoryId);
    if (query.collectionId) params.set('collectionId', query.collectionId);
    if (query.search) params.set('search', query.search);
    if (query.activeFilters) {
      for (const [key, values] of Object.entries(query.activeFilters)) {
        if (values.length > 0) params.set(`filter[${key}]`, values.join(','));
      }
    }
    const qs = params.toString();
    return apiClient<{filters: FilterGroup[]}>(
      `/storefront/filters${qs ? `?${qs}` : ''}`,
    );
  },
};

export const SORT_OPTIONS = [
  {value: '', label: 'Recommended'},
  // Values must match the backend `sortBy` enum (underscores, not
  // hyphens) or the API silently falls back to default ordering.
  {value: 'price_asc', label: 'Price: low to high'},
  {value: 'price_desc', label: 'Price: high to low'},
  {value: 'newest', label: 'Newest first'},
  {value: 'popular', label: 'Best selling'},
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]['value'];
