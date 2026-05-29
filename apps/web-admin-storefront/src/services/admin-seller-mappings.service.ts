import { apiClient, ApiResponse } from '@/lib/api-client';

export type MappingApprovalStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'STOPPED';

export type MappingDisplayStatus =
  | 'ACTIVE'
  | 'PENDING_APPROVAL'
  | 'INACTIVE'
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK';

export interface SellerMapping {
  id: string;
  productId: string;
  variantId: string | null;
  sellerId: string;
  seller?: {
    id: string;
    sellerName?: string | null;
    sellerShopName?: string | null;
    email?: string | null;
  };
  product?: { id: string; title: string };
  variant?: { id: string; sku?: string | null; title?: string | null } | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  lowStockThreshold: number;
  sellerInternalSku: string | null;
  settlementPrice: number | null;
  procurementCost: number | null;
  pickupAddress: string | null;
  pickupPincode: string | null;
  latitude: number | null;
  longitude: number | null;
  dispatchSla: number;
  isActive: boolean;
  approvalStatus: MappingApprovalStatus;
  mappingDisplayStatus: MappingDisplayStatus;
  operationalPriority: number;
  createdAt: string;
  updatedAt: string;
}

export interface MappingListResponse {
  mappings: SellerMapping[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface MappingListParams {
  page?: number;
  limit?: number;
  sellerId?: string;
  productId?: string;
  isActive?: 'true' | 'false' | '';
  approvalStatus?: MappingApprovalStatus | '';
  search?: string;
}

export const adminSellerMappingsService = {
  /** GET /admin/seller-mappings — cross-seller, cross-product mapping list. */
  list(params: MappingListParams = {}): Promise<ApiResponse<MappingListResponse>> {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('limit', String(params.limit ?? 20));
    if (params.sellerId) qs.set('sellerId', params.sellerId);
    if (params.productId) qs.set('productId', params.productId);
    if (params.isActive) qs.set('isActive', params.isActive);
    if (params.approvalStatus) qs.set('approvalStatus', params.approvalStatus);
    if (params.search) qs.set('search', params.search);
    return apiClient<MappingListResponse>(
      `/admin/seller-mappings?${qs.toString()}`,
    );
  },

  /**
   * PATCH /admin/seller-mappings/:id — admin override of any mapping field.
   * Backend validates each field; passing only the keys you want to change
   * leaves the rest untouched.
   */
  update(
    mappingId: string,
    patch: Partial<{
      stockQty: number;
      reservedQty: number;
      sellerInternalSku: string | null;
      settlementPrice: number | null;
      procurementCost: number | null;
      pickupAddress: string | null;
      pickupPincode: string | null;
      latitude: number | null;
      longitude: number | null;
      dispatchSla: number;
      isActive: boolean;
      operationalPriority: number;
      lowStockThreshold: number;
    }>,
  ): Promise<ApiResponse<SellerMapping>> {
    return apiClient<SellerMapping>(
      `/admin/seller-mappings/${mappingId}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  },

  approve(mappingId: string): Promise<ApiResponse<SellerMapping>> {
    return apiClient<SellerMapping>(
      `/admin/seller-mappings/${mappingId}/approve`,
      { method: 'POST' },
    );
  },

  stop(mappingId: string): Promise<ApiResponse<SellerMapping>> {
    return apiClient<SellerMapping>(
      `/admin/seller-mappings/${mappingId}/stop`,
      { method: 'POST' },
    );
  },
};
