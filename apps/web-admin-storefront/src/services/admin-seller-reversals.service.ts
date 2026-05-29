import { apiClient, ApiResponse } from '@/lib/api-client';

export type SellerReversalStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface SellerReversalItem {
  id: string;
  orderItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPriceInPaise: string;
}

export interface SellerReversal {
  id: string;
  subOrderId: string;
  sellerId: string;
  masterOrderId: string;
  status: SellerReversalStatus;
  reason: string;
  reversalValueInPaise: string;
  requestedAt: string;
  decidedByAdminId: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  items: SellerReversalItem[];
}

export interface SellerReversalsPage {
  items: SellerReversal[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const adminSellerReversalsService = {
  list(
    params: { status?: string; sellerId?: string; page?: number; limit?: number } = {},
  ): Promise<ApiResponse<SellerReversalsPage>> {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.sellerId) qs.set('sellerId', params.sellerId);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiClient(`/admin/seller-reversals${suffix}`);
  },

  get(id: string): Promise<ApiResponse<SellerReversal>> {
    return apiClient(`/admin/seller-reversals/${id}`);
  },

  approve(id: string): Promise<ApiResponse<{ reversalId: string; status: string }>> {
    return apiClient(`/admin/seller-reversals/${id}/approve`, { method: 'PATCH' });
  },

  reject(
    id: string,
    rejectionReason: string,
  ): Promise<ApiResponse<{ reversalId: string; status: string }>> {
    return apiClient(`/admin/seller-reversals/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ rejectionReason }),
    });
  },
};
