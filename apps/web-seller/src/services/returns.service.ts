import { apiClient } from '@/lib/api-client';

export interface SellerReturnItem {
  id: string;
  quantity: number;
  reasonCategory: string;
  reasonDetail: string | null;
  qcOutcome: string | null;
  qcQuantityApproved: number | null;
  qcNotes: string | null;
  orderItem?: {
    productTitle: string;
    variantTitle: string | null;
    imageUrl: string | null;
    unitPrice: number;
  };
}

export interface SellerReturnEvidence {
  id: string;
  fileUrl: string;
  description: string | null;
}

export interface SellerReturn {
  id: string;
  returnNumber: string;
  status: string;
  customerId: string;
  subOrderId: string;
  refundAmount: number | null;
  pickupScheduledAt: string | null;
  pickupTrackingNumber: string | null;
  pickupCourier: string | null;
  receivedAt: string | null;
  qcCompletedAt: string | null;
  qcDecision: string | null;
  createdAt: string;
  items: SellerReturnItem[];
  evidence?: SellerReturnEvidence[];
  masterOrder?: { orderNumber: string };
}

export const sellerReturnsService = {
  list(params: { page?: number; limit?: number; status?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    const query = qs.toString();
    return apiClient<{
      returns: SellerReturn[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/seller/returns${query ? `?${query}` : ''}`);
  },

  get(returnId: string) {
    return apiClient<SellerReturn>(`/seller/returns/${returnId}`);
  },

  markReceived(returnId: string, notes?: string) {
    return apiClient(`/seller/returns/${returnId}/mark-received`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });
  },

  submitQc(
    returnId: string,
    decisions: Array<{
      returnItemId: string;
      qcOutcome: string;
      qcQuantityApproved: number;
      qcNotes?: string;
    }>,
    overallNotes?: string,
  ) {
    return apiClient(`/seller/returns/${returnId}/qc-decision`, {
      method: 'PATCH',
      body: JSON.stringify({ decisions, overallNotes }),
    });
  },

  uploadEvidence(returnId: string, file: File, description?: string) {
    const formData = new FormData();
    formData.append('image', file);
    if (description) formData.append('description', description);
    return apiClient(`/seller/returns/${returnId}/qc-evidence`, {
      method: 'POST',
      body: formData,
    });
  },
};
