import {apiClient, ApiResponse} from '../lib/api-client';

// Public stats surfaced on the About screen (and any future marketing
// surface). All fields are optional so the hook can degrade gracefully
// if the backend endpoint isn't deployed yet — the screen falls back
// to a hardcoded baseline.
export interface StorefrontStats {
  athletes?: number;
  brands?: number;
  stores?: number;
  products?: number;
  averageRating?: number;
}

export const statsService = {
  getStorefrontStats(): Promise<ApiResponse<StorefrontStats>> {
    return apiClient<StorefrontStats>('/storefront/stats', {
      method: 'GET',
    });
  },
};
