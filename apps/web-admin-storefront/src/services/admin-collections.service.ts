import { apiClient, ApiResponse } from '@/lib/api-client';

export interface CollectionListItem {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  isActive: boolean;
  productCount: number;
}

export const adminCollectionsService = {
  list(): Promise<ApiResponse<{ collections: CollectionListItem[] }>> {
    return apiClient('/admin/collections?limit=100');
  },
};
