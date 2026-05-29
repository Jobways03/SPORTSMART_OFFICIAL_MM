import { apiClient } from '@/lib/api-client';

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
  status: SellerReversalStatus;
  reason: string;
  reversalValueInPaise: string;
  requestedAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  items: SellerReversalItem[];
}

export interface SellerReversalsPage {
  items: SellerReversal[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const sellerReversalsService = {
  list(params: { status?: string; page?: number; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiClient<SellerReversalsPage>(`/seller/reversals${suffix}`);
  },

  cancel(id: string) {
    return apiClient(`/seller/reversals/${id}/cancel`, { method: 'PATCH' });
  },
};
