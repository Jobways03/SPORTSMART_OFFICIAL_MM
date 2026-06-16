import { apiClient, ApiResponse } from '@/lib/api-client';

export type RefundInstructionStatus =
  | 'PENDING_APPROVAL'
  | 'NEEDS_CLARIFICATION'
  | 'APPROVED'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'SETTLED'
  | 'FAILED'
  | 'RETRYING'
  | 'MANUAL_REQUIRED'
  | 'CANCELLED'
  // Phase 171 — finance-rejection terminal states.
  | 'REJECTED'
  | 'ROUTED_BACK_TO_DISPUTE';

export type RefundMethod =
  | 'WALLET'
  | 'ORIGINAL_PAYMENT'
  | 'BANK_TRANSFER'
  | 'UPI'
  | 'COUPON'
  | 'MANUAL';

export type RefundSourceType = 'RETURN' | 'DISPUTE' | 'GOODWILL';

export interface RefundInstructionRow {
  id: string;
  sourceType: RefundSourceType;
  sourceId: string;
  customerId: string;
  orderId: string | null;
  // BigInt arrives as a string from the API (we map it server-side
  // to keep wire format independent of the global toJSON shim).
  amountInPaise: string;
  currency: string;
  refundMethod: RefundMethod;
  status: RefundInstructionStatus;
  idempotencyKey: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  // Phase 125 — dual-approval (two-person rule). The first approver of a
  // high-value refund; the row stays PENDING_APPROVAL until a second, DISTINCT
  // approver releases it (then approvedBy holds that second approver).
  firstApprovedBy: string | null;
  firstApprovedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  processedAt: string | null;
  failureReason: string | null;
  attempts: number;
  walletTransactionId: string | null;
  gatewayRefundId: string | null;
  // Phase 170 (#6/#10) — approval SLA + clarification context.
  approvalDueBy: string | null;
  clarificationNote: string | null;
  clarificationBy: string | null;
  clarificationAt: string | null;
  // Phase 171 — finance route-back context.
  linkedDisputeId: string | null;
  customerVisibleReason: string | null;
  routedBackAt: string | null;
  routedBackBy: string | null;
  // Phase 172 — goodwill markers.
  isGoodwill: boolean;
  customerRemedy: string | null;
  customerVisibleMessage: string | null;
  createdAt: string;
  updatedAt: string;
  // Transient flags returned by the approve/reject mutations (NOT persisted):
  //  - approve → pendingSecondApproval=true means only the FIRST of two
  //    required approvals was recorded; a second, distinct approver must still
  //    approve before the money moves.
  pendingSecondApproval?: boolean;
  //  - reject → summary of the dispute liability-ledger reversal that ran.
  liabilityReversal?: {
    reversedAny: boolean;
    needsManual: boolean;
  } | null;
}

/**
 * Inline source context returned by the detail GET — lets finance see
 * the dispute / return summary without a second API call (and without
 * needing the disputes.read / returns.read permissions).
 */
export interface RefundInstructionSourceMessage {
  id: string;
  senderType: 'CUSTOMER' | 'SELLER' | 'ADMIN' | 'FRANCHISE' | 'AFFILIATE';
  senderName: string;
  body: string;
  createdAt: string;
}

export interface RefundInstructionSource {
  sourceType: RefundSourceType;
  id: string;
  // Optional: MANUAL / GOODWILL / REPLACEMENT / VERIFICATION_REJECTION have no
  // linked entity — they carry a `label` + `reason` instead of number/status.
  number?: string;
  status?: string;
  /** Human label for source types without a rich entity. */
  label?: string | null;
  /** Reason captured on the instruction (generic-source fallback). */
  reason?: string | null;
  // Dispute-specific
  kind?: string | null;
  summary?: string | null;
  filedByName?: string | null;
  filedByType?: string | null;
  decisionRationale?: string | null;
  decisionAmountInPaise?: number | null;
  decisionAt?: string | null;
  liabilityParty?: string | null;
  customerRemedy?: string | null;
  /** Full chat thread (admin-only internal notes excluded). */
  messages?: RefundInstructionSourceMessage[];
  // Return-specific
  customerNotes?: string | null;
  rejectionReason?: string | null;
  qcNotes?: string | null;
  refundAmount?: string | null;
  // Shared
  orderNumber?: string | null;
  returnNumber?: string | null;
}

export interface RefundInstructionOrder {
  orderNumber: string;
  orderStatus: string;
  paymentMethod: string;
  // Cancellation provenance (null unless the order was cancelled).
  cancelledAt: string | null;
  cancelReason: string | null;
  cancellationSource: string | null; // ADMIN | CUSTOMER | SYSTEM
  cancelledByName: string | null;
}

export interface RefundInstructionCustomer {
  name: string;
  email: string;
  phone: string | null;
}

export interface RefundInstructionRequestedBy {
  name: string | null;
  actorId: string | null;
  notes: string | null;
  at: string;
}

export interface RefundInstructionDetail extends RefundInstructionRow {
  source: RefundInstructionSource | null;
  /** Phase 253 — resolved context so finance never approves blind. */
  order: RefundInstructionOrder | null;
  customer: RefundInstructionCustomer | null;
  requestedBy: RefundInstructionRequestedBy | null;
}

export interface RefundInstructionListPage {
  items: RefundInstructionRow[];
  total: number;
  page: number;
  limit: number;
}

export const adminRefundApprovalsService = {
  list(filters: {
    status?: RefundInstructionStatus;
    page?: number;
    limit?: number;
    // Phase 170 (#8/#6) — triage filters + overdue view.
    sourceType?: RefundSourceType | '';
    refundMethod?: RefundMethod | '';
    overdue?: boolean;
    // Phase 172 (#17) — goodwill-only filter.
    goodwill?: boolean;
  } = {}): Promise<ApiResponse<RefundInstructionListPage>> {
    const qs = new URLSearchParams();
    if (filters.status) qs.set('status', filters.status);
    qs.set('page', String(filters.page ?? 1));
    qs.set('limit', String(filters.limit ?? 20));
    if (filters.sourceType) qs.set('sourceType', filters.sourceType);
    if (filters.refundMethod) qs.set('refundMethod', filters.refundMethod);
    if (filters.overdue) qs.set('overdue', 'true');
    if (filters.goodwill) qs.set('goodwill', 'true');
    return apiClient<RefundInstructionListPage>(
      `/admin/refund-instructions?${qs.toString()}`,
    );
  },
  get(id: string): Promise<ApiResponse<RefundInstructionDetail>> {
    return apiClient<RefundInstructionDetail>(`/admin/refund-instructions/${id}`);
  },
  approve(id: string): Promise<ApiResponse<RefundInstructionRow>> {
    return apiClient<RefundInstructionRow>(
      `/admin/refund-instructions/${id}/approve`,
      { method: 'PATCH', headers: { 'X-Idempotency-Key': `refund-approve-${id}` } },
    );
  },
  reject(
    id: string,
    reason: string,
    customerVisibleReason?: string,
  ): Promise<ApiResponse<RefundInstructionRow>> {
    return apiClient<RefundInstructionRow>(
      `/admin/refund-instructions/${id}/reject`,
      {
        method: 'PATCH',
        body: JSON.stringify(
          customerVisibleReason ? { reason, customerVisibleReason } : { reason },
        ),
        headers: { 'X-Idempotency-Key': `refund-reject-${id}` },
      },
    );
  },
  // Phase 170 (#9) — bulk approve.
  bulkApprove(ids: string[]): Promise<ApiResponse<{ approved: number; failed: number; results: Array<{ id: string; ok: boolean; reason?: string }> }>> {
    return apiClient(`/admin/refund-instructions/bulk-approve`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
      headers: { 'X-Idempotency-Key': `refund-bulk-${ids.slice().sort().join(',').slice(0, 80)}` },
    });
  },
  // Phase 170 (#15) — undo a wrong rejection.
  revertRejection(id: string, reason: string): Promise<ApiResponse<RefundInstructionRow>> {
    return apiClient<RefundInstructionRow>(
      `/admin/refund-instructions/${id}/revert-rejection`,
      { method: 'PATCH', body: JSON.stringify({ reason }), headers: { 'X-Idempotency-Key': `refund-revert-${id}` } },
    );
  },
  // Phase 170 (#10) — request clarification.
  requestInfo(id: string, question: string): Promise<ApiResponse<RefundInstructionRow>> {
    return apiClient<RefundInstructionRow>(
      `/admin/refund-instructions/${id}/request-info`,
      { method: 'PATCH', body: JSON.stringify({ question }) },
    );
  },
};

export const STATUS_COLOR: Record<RefundInstructionStatus, string> = {
  PENDING_APPROVAL: '#d97706',
  NEEDS_CLARIFICATION: '#9333ea',
  APPROVED: '#2A8595',
  PROCESSING: '#2A8595',
  SUCCESS: '#15803d',
  SETTLED: '#15803d',
  FAILED: '#b91c1c',
  RETRYING: '#d97706',
  MANUAL_REQUIRED: '#b45309',
  CANCELLED: '#7A828F',
  REJECTED: '#b91c1c',
  ROUTED_BACK_TO_DISPUTE: '#7c3aed',
};

export const STATUS_LABEL: Record<RefundInstructionStatus, string> = {
  PENDING_APPROVAL: 'Pending approval',
  NEEDS_CLARIFICATION: 'Needs clarification',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  SUCCESS: 'Success',
  SETTLED: 'Settled',
  FAILED: 'Failed',
  RETRYING: 'Retrying',
  MANUAL_REQUIRED: 'Manual required',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected by finance',
  ROUTED_BACK_TO_DISPUTE: 'Routed back to dispute',
};
