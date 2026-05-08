import { apiClient, ApiResponse } from '@/lib/api-client';

export type RefundInstructionStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'RETRYING'
  | 'MANUAL_REQUIRED'
  | 'CANCELLED';

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
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  processedAt: string | null;
  failureReason: string | null;
  attempts: number;
  walletTransactionId: string | null;
  gatewayRefundId: string | null;
  createdAt: string;
  updatedAt: string;
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
  sourceType: 'DISPUTE' | 'RETURN';
  id: string;
  number: string;
  status: string;
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

export interface RefundInstructionDetail extends RefundInstructionRow {
  source: RefundInstructionSource | null;
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
  } = {}): Promise<ApiResponse<RefundInstructionListPage>> {
    const qs = new URLSearchParams();
    if (filters.status) qs.set('status', filters.status);
    qs.set('page', String(filters.page ?? 1));
    qs.set('limit', String(filters.limit ?? 20));
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
      { method: 'PATCH' },
    );
  },
  reject(
    id: string,
    reason: string,
  ): Promise<ApiResponse<RefundInstructionRow>> {
    return apiClient<RefundInstructionRow>(
      `/admin/refund-instructions/${id}/reject`,
      { method: 'PATCH', body: JSON.stringify({ reason }) },
    );
  },
};

export const STATUS_COLOR: Record<RefundInstructionStatus, string> = {
  PENDING_APPROVAL: '#d97706',
  APPROVED: '#2A8595',
  PROCESSING: '#2A8595',
  SUCCESS: '#15803d',
  FAILED: '#b91c1c',
  RETRYING: '#d97706',
  MANUAL_REQUIRED: '#b45309',
  CANCELLED: '#7A828F',
};

export const STATUS_LABEL: Record<RefundInstructionStatus, string> = {
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  RETRYING: 'Retrying',
  MANUAL_REQUIRED: 'Manual required',
  CANCELLED: 'Cancelled',
};
