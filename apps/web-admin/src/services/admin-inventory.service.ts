import { apiClient, ApiResponse } from '@/lib/api-client';

// ── Types ────────────────────────────────────────────────────────────────

export interface InventoryOverview {
  totalMappedProducts: number;
  totalMappedVariants: number;
  totalStock: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface LowStockItem {
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

export interface OutOfStockProduct {
  productId: string;
  productTitle: string;
  productCode: string;
  hasVariants: boolean;
  variantId: string | null;
  variantSku: string | null;
  totalStock: number;
  totalReserved: number;
  sellerCount: number;
}

export interface ActiveReservation {
  id: string;
  mappingId: string;
  quantity: number;
  status: string;
  orderId: string | null;
  expiresAt: string;
  createdAt: string;
  seller: { id: string; name: string };
  product: { id: string; title: string; code: string };
  variant: { id: string; sku: string; masterSku: string } | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ── Service ──────────────────────────────────────────────────────────────

export const adminInventoryService = {
  async getOverview(): Promise<ApiResponse<InventoryOverview>> {
    return apiClient<InventoryOverview>('/admin/inventory/overview');
  },

  async getLowStock(params?: {
    page?: number;
    limit?: number;
    sellerId?: string;
  }): Promise<ApiResponse<{ items: LowStockItem[]; pagination: Pagination }>> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sellerId) query.set('sellerId', params.sellerId);
    const qs = query.toString();
    return apiClient(`/admin/inventory/low-stock${qs ? `?${qs}` : ''}`);
  },

  async getOutOfStock(params?: {
    page?: number;
    limit?: number;
  }): Promise<ApiResponse<{ items: OutOfStockProduct[]; pagination: Pagination }>> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient(`/admin/inventory/out-of-stock${qs ? `?${qs}` : ''}`);
  },

  async getReservations(params?: {
    page?: number;
    limit?: number;
    mappingId?: string;
    orderId?: string;
  }): Promise<ApiResponse<{ reservations: ActiveReservation[]; pagination: Pagination }>> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.mappingId) query.set('mappingId', params.mappingId);
    if (params?.orderId) query.set('orderId', params.orderId);
    const qs = query.toString();
    return apiClient(`/admin/inventory/reservations${qs ? `?${qs}` : ''}`);
  },
};
