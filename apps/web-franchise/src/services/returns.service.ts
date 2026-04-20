import { apiClient } from '@/lib/api-client';

export interface FranchiseReturnItem {
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

export interface FranchiseReturnEvidence {
  id: string;
  fileUrl: string;
  description: string | null;
}

export interface FranchiseReturn {
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
  items: FranchiseReturnItem[];
  evidence?: FranchiseReturnEvidence[];
  masterOrder?: { orderNumber: string };
}

export const franchiseReturnsService = {
  list(params: { page?: number; limit?: number; status?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    return apiClient<{
      returns: FranchiseReturn[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/franchise/returns?${qs.toString()}`);
  },

  get(returnId: string) {
    return apiClient<FranchiseReturn>(`/franchise/returns/${returnId}`);
  },

  markReceived(returnId: string, notes?: string) {
    return apiClient(`/franchise/returns/${returnId}/mark-received`, {
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
    return apiClient(`/franchise/returns/${returnId}/qc-decision`, {
      method: 'PATCH',
      body: JSON.stringify({ decisions, overallNotes }),
    });
  },

  uploadEvidence(returnId: string, file: File, description?: string) {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const token =
      typeof window !== 'undefined' ? sessionStorage.getItem('accessToken') : null;
    const formData = new FormData();
    formData.append('file', file);
    if (description) formData.append('description', description);
    return fetch(`${API_BASE}/api/v1/franchise/returns/${returnId}/qc-evidence`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message || 'Failed to upload evidence');
      return body;
    });
  },
};
