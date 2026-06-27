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
    // The backend (return_evidence.file_url) returns `fileUrl`; `url`/`viewUrl`
    // are legacy/optional aliases. Read fileUrl first.
    fileUrl?: string | null;
    url?: string | null;
    viewUrl?: string | null;
    description?: string | null;
  }>;
  statusHistory?: Array<{
    id: string;
    // ReturnStatusHistory exposes `toStatus` / `notes` (matches D2C/Retail
    // services). The prior `status` / `note` fields didn't exist on the row, so
    // the timeline rendered "—" with no notes.
    toStatus: string;
    notes?: string | null;
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

  // ── Lifecycle actions ──────────────────────────────────────────────────
  //
  // All hit the node-scoped /admin/franchise-returns/:id/* endpoints (which
  // assertNodeOwnsReturn so a franchise admin can only act on its OWN
  // franchise's returns) and require the franchise.returns.manage /
  // franchise.returns.refund permissions.

  approve(returnId: string, franchiseId: string, notes?: string): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'approve', { notes });
  },

  reject(returnId: string, franchiseId: string, reason: string): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'reject', { reason });
  },

  schedulePickup(
    returnId: string,
    franchiseId: string,
    payload: {
      pickupScheduledAt: string;
      pickupTrackingNumber?: string;
      pickupCourier?: string;
      pickupAddress?: string;
    },
  ): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'schedule-pickup', payload);
  },

  markReceived(
    returnId: string,
    franchiseId: string,
    payload: { notes?: string; parcelCondition?: string } = {},
  ): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'mark-received', payload);
  },

  /**
   * Submit the QC decision for a franchise return via the node-scoped
   * franchise endpoint (franchise.returns.manage). assertNodeOwnsReturn on the
   * server ensures only this franchise's returns are touched.
   */
  submitQcDecision(
    returnId: string,
    franchiseId: string,
    payload: SubmitQcDecisionPayload,
  ): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'qc-decision', payload);
  },

  // Refund (franchise.returns.refund — moves money)
  initiateRefund(
    returnId: string,
    franchiseId: string,
    refundMethod?: RefundMethod,
  ): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'initiate-refund', { refundMethod });
  },

  confirmRefund(
    returnId: string,
    franchiseId: string,
    payload: { refundReference: string; refundMethod?: RefundMethod; notes?: string },
  ): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'confirm-refund', payload);
  },

  markRefundFailed(returnId: string, franchiseId: string, reason: string): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'mark-refund-failed', { reason });
  },

  retryRefund(returnId: string, franchiseId: string): Promise<ApiResponse> {
    return franchiseAction(returnId, franchiseId, 'retry-refund');
  },
};

export type RefundMethod =
  | 'ORIGINAL_PAYMENT'
  | 'WALLET'
  | 'BANK_TRANSFER'
  | 'CASH';

/** PATCH /admin/franchise-returns/:id/<action>?franchiseId=… */
function franchiseAction(
  returnId: string,
  franchiseId: string,
  action: string,
  body?: unknown,
): Promise<ApiResponse> {
  return apiClient(
    `/admin/franchise-returns/${returnId}/${action}?franchiseId=${encodeURIComponent(franchiseId)}`,
    { method: 'PATCH', body: JSON.stringify(body ?? {}) },
  );
}
