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
  // Phase 13 (P1.8) — seller-response lifecycle. Drives the
  // "respond" UI: PENDING + due-soon shows the button + countdown;
  // ACCEPTED / CONTESTED / EXPIRED / NOT_REQUIRED hide it.
  sellerResponseStatus?:
    | 'NOT_REQUIRED'
    | 'PENDING'
    | 'ACCEPTED'
    | 'CONTESTED'
    | 'EXPIRED'
    | null;
  sellerNotifiedAt?: string | null;
  sellerResponseDueAt?: string | null;
  sellerRespondedAt?: string | null;
  sellerResponseNotes?: string | null;
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

  // Phase 100 (2026-05-23) — Mark Received audit Gap #3 / QC audit
  // Gap #1 closure. The `/seller/returns/:id/qc-decision` route does
  // NOT exist on the backend; QC is admin-only by design (the
  // ReturnService.submitQcDecision guard refuses non-ADMIN actorType
  // for defense-in-depth). The previous submitQc method 404'd on
  // every click. Removed entirely so callers fail at compile time
  // instead of at runtime.

  uploadEvidence(returnId: string, file: File, description?: string) {
    const formData = new FormData();
    formData.append('image', file);
    if (description) formData.append('description', description);
    return apiClient(`/seller/returns/${returnId}/qc-evidence`, {
      method: 'POST',
      body: formData,
    });
  },

  /**
   * Phase 13 (P1.8) — accept or contest a return that alleged seller
   * fault. Service enforces:
   *   - PENDING-only state
   *   - response-window not >1h past due
   *   - CONTESTED requires notes
   */
  respond(
    returnId: string,
    payload: {
      decision: 'ACCEPTED' | 'CONTESTED';
      notes?: string;
      evidenceFileUrls?: string[];
    },
  ) {
    return apiClient(`/seller/returns/${returnId}/respond`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};
