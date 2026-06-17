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
  // Seller/franchise response lifecycle — when a customer alleges node fault,
  // the franchise gets a window to accept or contest before admin QC.
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

  // Phase 100 (2026-05-23) — Mark Received audit Gap #4 / QC audit
  // Gap #2 closure. The `/franchise/returns/:id/qc-decision` route
  // does NOT exist on the backend; QC is admin-only (the
  // submitQcDecision actorType guard rejects non-ADMIN). Removed.

  // Phase 100 (2026-05-23) — Mark Received audit Gap #5 closure.
  // Pre-Phase-100 the field name was 'file' but the backend's
  // FileInterceptor('image') expects 'image' — every franchise QC
  // evidence upload 400'd at the boundary. Aligned with the
  // controller's expected field name.
  uploadEvidence(returnId: string, file: File, description?: string) {
    const formData = new FormData();
    formData.append('image', file);
    if (description) formData.append('description', description);
    return apiClient(`/franchise/returns/${returnId}/qc-evidence`, {
      method: 'POST',
      body: formData,
    });
  },

  // PATCH /franchise/returns/:id/respond — accept or contest a fault claim.
  // @Idempotent on the backend → pass a stable X-Idempotency-Key per submission.
  respond(
    returnId: string,
    payload: {
      decision: 'ACCEPTED' | 'CONTESTED';
      notes?: string;
      evidenceFileUrls?: string[];
      contestReasonCategory?: string;
    },
    idempotencyKey: string,
  ) {
    return apiClient(`/franchise/returns/${returnId}/respond`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'X-Idempotency-Key': idempotencyKey },
    });
  },

  // PATCH /franchise/returns/:id/respond/rescind — flip ACCEPTED↔CONTESTED
  // within the original window + 1h grace.
  rescindResponse(
    returnId: string,
    payload: {
      newDecision: 'ACCEPTED' | 'CONTESTED';
      notes?: string;
      contestReasonCategory?: string;
    },
    idempotencyKey: string,
  ) {
    return apiClient(`/franchise/returns/${returnId}/respond/rescind`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'X-Idempotency-Key': idempotencyKey },
    });
  },
};
