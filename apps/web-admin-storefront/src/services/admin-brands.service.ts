import { apiClient, ApiResponse } from '@/lib/api-client';

export interface BrandListItem {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  isActive?: boolean;
}

export const adminBrandsService = {
  list(): Promise<ApiResponse<{ brands: BrandListItem[] }>> {
    return apiClient('/admin/brands?limit=100');
  },
};
