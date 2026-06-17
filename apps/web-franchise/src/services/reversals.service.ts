import { apiClient } from '@/lib/api-client';

export type FranchiseReversalStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface FranchiseReversalItem {
  id: string;
  orderItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPriceInPaise: string; // BigInt as string
}

export interface FranchiseReversal {
  id: string;
  subOrderId: string;
  status: FranchiseReversalStatus;
  reason: string;
  reversalValueInPaise: string; // BigInt as string
  requestedAt: string; // ISO datetime
  decidedAt: string | null;
  rejectionReason: string | null;
  items: FranchiseReversalItem[];
}

export interface FranchiseReversalsPage {
  items: FranchiseReversal[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const franchiseReversalsService = {
  list(params: { status?: string; page?: number; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiClient<FranchiseReversalsPage>(`/franchise/reversals${suffix}`);
  },

  cancel(id: string) {
    return apiClient(`/franchise/reversals/${id}/cancel`, { method: 'PATCH' });
  },
};
