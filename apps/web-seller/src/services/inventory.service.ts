// Seller-scoped inventory service. Backs /dashboard/inventory.
// All endpoints are seller-scoped on the backend (SellerAuthGuard),
// so this view is automatically limited to the logged-in seller's mappings.

import { apiClient, ApiResponse } from '@/lib/api-client';

export interface InventoryOverview {
  totalMappedProducts: number;
  totalMappedVariants: number;
  totalStock: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface InventoryItem {
  id: string;
  sellerId: string;
  sellerName: string;
  productId: string;
  productTitle: string;
  variantId: string | null;
  variantSku: string | null;
  masterSku: string | null;
  stockQty: number;
  reservedQty: number;
  availableStock: number;
  lowStockThreshold: number;
  isActive: boolean;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const sellerInventoryService = {
  getOverview(): Promise<ApiResponse<InventoryOverview>> {
    return apiClient<InventoryOverview>('/seller/catalog/inventory-overview');
  },

  getLowStock(params?: {
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<{ items: InventoryItem[]; pagination: Pagination }>> {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiClient(`/seller/catalog/low-stock${qs ? `?${qs}` : ''}`);
  },

  getOutOfStock(params?: {
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<{ items: InventoryItem[]; pagination: Pagination }>> {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiClient(`/seller/catalog/out-of-stock${qs ? `?${qs}` : ''}`);
  },

  adjustStock(mappingId: string, adjustment: number) {
    return apiClient<{
      mappingId: string;
      stockQty: number;
      reservedQty: number;
      availableStock: number;
    }>(`/seller/catalog/mapping/${mappingId}/adjust-stock`, {
      method: 'POST',
      body: JSON.stringify({ adjustment }),
    });
  },
};
