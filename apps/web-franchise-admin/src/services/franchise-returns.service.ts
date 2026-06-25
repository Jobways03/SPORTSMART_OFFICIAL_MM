import { apiClient, ApiResponse } from '@/lib/api-client';

export interface FranchiseReturnItem {
  id: string;
  quantity?: number;
  reasonCategory?: string | null;
  reasonDetail?: string | null;
  // Populated after a QC decision (optional — only present once QC'd).
  qcOutcome?: string | null;
  qcQuantityApproved?: number | null;
  qcNotes?: string | null;
  refundAmount?: string | number | null;
  orderItem?: {
    productTitle?: string | null;
    variantTitle?: string | null;
    sku?: string | null;
    imageUrl?: string | null;
  } | null;
}

export interface FranchiseReturnListItem {
  id: string;
  returnNumber?: string | null;
  status: string;
  createdAt: string;
  totalRefundAmount?: string | number | null;
  refundAmount?: string | number | null;
  items?: FranchiseReturnItem[];
  subOrder?: {
    id?: string;
    fulfillmentNodeType?: string | null;
    masterOrder?: { orderNumber?: string } | null;
  } | null;
}

export interface FranchiseReturnDetail extends FranchiseReturnListItem {
  reason?: string | null;
  refundStatus?: string | null;
  updatedAt?: string | null;
  evidence?: Array<{
    id: string;
    url?: string | null;
    viewUrl?: string | null;
    description?: string | null;
  }>;
  statusHistory?: Array<{
    id: string;
    status: string;
    note?: string | null;
    createdAt: string;
  }>;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
}

// Franchise's pre-ship "proof of dispatch" photos (attached to the SUB-ORDER,
// not the return). SHIPMENT_EVIDENCE files are PRIVATE, so the admin endpoint
// enriches each row with a short-lived `viewUrl` (providerUrl is null in the DB).
export interface FranchiseShipmentEvidence {
  id: string;
  kind?: string;
  capturedAt?: string;
  viewUrl?: string;
  file: { id: string; fileName: string; providerUrl?: string | null };
}

// QC decision types — mirror the backend ADR-016 decision matrix. The QC
// decision is the marketplace admin's call (the franchise only receives +
// uploads evidence), submitted via the shared admin qc-decision endpoint.
export type QcOutcome = 'APPROVED' | 'REJECTED' | 'PARTIAL' | 'DAMAGED';
export type LiabilityParty =
  | 'SELLER'
  | 'LOGISTICS'
  | 'PLATFORM'
  | 'CUSTOMER'
  | 'FRANCHISE'
  | 'BRAND'
  | 'INCONCLUSIVE'
  | 'NONE';
export type CustomerRemedy =
  | 'FULL_REFUND'
  | 'PARTIAL_REFUND'
  | 'NO_REFUND'
  | 'GOODWILL_CREDIT';
export interface SubmitQcDecisionPayload {
  decisions: Array<{
    returnItemId: string;
    qcOutcome: QcOutcome;
    qcQuantityApproved: number;
    qcNotes?: string;
  }>;
  overallNotes?: string;
  // Required by the backend when any item is approved/partial.
  liabilityParty?: LiabilityParty;
  customerRemedy?: CustomerRemedy;
}

export const franchiseReturnsService = {
  list(
    franchiseId: string,
    params: { page?: number; limit?: number; status?: string } = {},
  ): Promise<
    ApiResponse<{ returns: FranchiseReturnListItem[]; total: number }>
  > {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    const q = qs.toString();
    return apiClient(
      `/admin/franchise-returns/franchises/${franchiseId}${q ? `?${q}` : ''}`,
    );
  },

  get(
    returnId: string,
    franchiseId: string,
  ): Promise<ApiResponse<FranchiseReturnDetail>> {
    return apiClient(
      `/admin/franchise-returns/${returnId}?franchiseId=${encodeURIComponent(franchiseId)}`,
    );
  },

  /**
   * Franchise's pre-ship evidence for a sub-order (proof-of-dispatch photos
   * uploaded at packing time). Surfaced on the return-review screen so the
   * admin can compare the as-shipped baseline against the customer's claim
   * before approving a contested return. Reads any sub-order's evidence via
   * the shared admin endpoint.
   */
  getShipmentEvidence(
    subOrderId: string,
  ): Promise<ApiResponse<FranchiseShipmentEvidence[]>> {
    return apiClient(`/admin/sub-orders/${subOrderId}/shipment-evidence`);
  },

  /**
   * Submit the QC decision for a franchise return. Uses the shared admin
   * qc-decision endpoint (the franchise-admin runs on the admin persona).
   * The backend's node-scoped guard ensures only this franchise's returns
   * are touched.
   */
  submitQcDecision(
    returnId: string,
    payload: SubmitQcDecisionPayload,
  ): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/qc-decision`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};
