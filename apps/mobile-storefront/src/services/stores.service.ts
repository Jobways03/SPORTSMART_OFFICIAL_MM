import {apiClient, ApiResponse} from '../lib/api-client';

// Physical store locator data. The HomeScreen surfaces a summary
// ("47 stores · Mumbai, Delhi, Bengaluru +") so we only need a
// minimal projection; a future Store Locator screen can switch to
// a paginated endpoint.
export interface StoreSummary {
  total: number;
  topCities: string[];
}

export const storesService = {
  summary(): Promise<ApiResponse<StoreSummary>> {
    return apiClient<StoreSummary>('/storefront/stores/summary');
  },
};
