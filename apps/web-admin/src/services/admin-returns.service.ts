import { apiClient, ApiResponse } from '@/lib/api-client';

export type ReturnStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PICKUP_SCHEDULED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'QC_APPROVED'
  | 'QC_REJECTED'
  | 'PARTIALLY_APPROVED'
  | 'REFUND_PROCESSING'
  | 'REFUNDED'
  | 'COMPLETED'
  | 'CANCELLED';

export type QcOutcome = 'APPROVED' | 'REJECTED' | 'PARTIAL' | 'DAMAGED';

export type RefundMethod =
  | 'ORIGINAL_PAYMENT'
  | 'WALLET'
  | 'BANK_TRANSFER'
  | 'CASH';

export interface ReturnOrderItemRef {
  id: string;
  productTitle?: string;
  variantTitle?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  unitPrice?: string | number | null;
  quantity?: number;
}

export interface ReturnItem {
  id: string;
  returnId: string;
  orderItemId: string;
  quantity: number;
  reasonCategory: string;
  reasonDetail?: string | null;
  qcOutcome?: QcOutcome | null;
  qcQuantityApproved?: number | null;
  qcNotes?: string | null;
  refundAmount?: string | number | null;
  createdAt: string;
  orderItem?: ReturnOrderItemRef | null;
}

export interface ReturnEvidence {
  id: string;
  returnId: string;
  uploadedBy: string;
  uploaderId?: string | null;
  fileType: string;
  fileUrl: string;
  publicId?: string | null;
  description?: string | null;
  createdAt: string;
}

export interface ReturnStatusHistoryEntry {
  id: string;
  returnId: string;
  fromStatus?: ReturnStatus | null;
  toStatus: ReturnStatus;
  changedBy: string;
  changedById?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ReturnSubOrderRef {
  id: string;
  fulfillmentStatus?: string;
  fulfillmentNodeType?: string;
  sellerId?: string | null;
  franchiseId?: string | null;
  masterOrder?: {
    id: string;
    orderNumber: string;
  };
}

export interface ReturnCustomerRef {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ReturnListItem {
  id: string;
  returnNumber: string;
  subOrderId: string;
  masterOrderId: string;
  customerId: string;
  status: ReturnStatus;
  initiatedBy: string;
  initiatorId?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  pickupScheduledAt?: string | null;
  pickupTrackingNumber?: string | null;
  pickupCourier?: string | null;
  receivedAt?: string | null;
  qcCompletedAt?: string | null;
  qcDecision?: QcOutcome | null;
  qcNotes?: string | null;
  refundMethod?: RefundMethod | null;
  refundAmount?: string | number | null;
  refundProcessedAt?: string | null;
  refundReference?: string | null;
  refundAttempts?: number;
  refundLastAttemptAt?: string | null;
  refundFailureReason?: string | null;
  refundInitiatedBy?: string | null;
  refundInitiatedAt?: string | null;
  customerNotes?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: ReturnItem[];
  subOrder?: ReturnSubOrderRef;
  customer?: ReturnCustomerRef;
  masterOrder?: { id: string; orderNumber: string };
}

export interface ReturnDetail extends ReturnListItem {
  items: ReturnItem[];
  evidence: ReturnEvidence[];
  statusHistory: ReturnStatusHistoryEntry[];
  subOrder?: ReturnSubOrderRef & Record<string, unknown>;
  masterOrder?: {
    id: string;
    orderNumber: string;
    [key: string]: unknown;
  };
  pickupAddress?: Record<string, unknown> | null;
}

export interface ReturnListResponse {
  returns: ReturnListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ListReturnsParams {
  page?: number;
  limit?: number;
  status?: string;
  customerId?: string;
  subOrderId?: string;
  fulfillmentNodeType?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

export interface ReturnsAnalyticsSummary {
  totalReturns: number;
  totalRefundAmount: number;
  byStatus: Record<string, number>;
  byReasonCategory: Record<string, number>;
  averageProcessingDays: number;
  refundedCount: number;
  rejectedCount: number;
  pendingCount: number;
  inProgressCount: number;
  refundSuccessRate: number;
}

export interface ReturnsTrendPoint {
  period: string;
  count: number;
  refundAmount: number;
}

export interface TopReasonItem {
  reasonCategory: string;
  count: number;
}

export interface SchedulePickupPayload {
  pickupScheduledAt: string;
  pickupTrackingNumber?: string;
  pickupCourier?: string;
}

export interface SubmitQcDecisionPayload {
  decisions: Array<{
    returnItemId: string;
    qcOutcome: QcOutcome;
    qcQuantityApproved: number;
    qcNotes?: string;
  }>;
  overallNotes?: string;
}

export interface ConfirmRefundPayload {
  refundReference: string;
  refundMethod?: RefundMethod;
  notes?: string;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      q.set(key, String(value));
    }
  });
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

export const adminReturnsService = {
  listReturns(
    params: ListReturnsParams = {},
  ): Promise<ApiResponse<ReturnListResponse>> {
    const qs = buildQuery({
      page: params.page,
      limit: params.limit,
      status: params.status,
      customerId: params.customerId,
      subOrderId: params.subOrderId,
      fulfillmentNodeType: params.fulfillmentNodeType,
      fromDate: params.fromDate,
      toDate: params.toDate,
      search: params.search,
    });
    return apiClient<ReturnListResponse>(`/admin/returns${qs}`);
  },

  getReturn(returnId: string): Promise<ApiResponse<ReturnDetail>> {
    return apiClient<ReturnDetail>(`/admin/returns/${returnId}`);
  },

  approveReturn(returnId: string, notes?: string): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });
  },

  rejectReturn(returnId: string, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  schedulePickup(
    returnId: string,
    payload: SchedulePickupPayload,
  ): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/schedule-pickup`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  markInTransit(returnId: string, trackingNumber?: string): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/mark-in-transit`, {
      method: 'PATCH',
      body: JSON.stringify({ trackingNumber }),
    });
  },

  markReceived(returnId: string, notes?: string): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/mark-received`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });
  },

  uploadQcEvidence(
    returnId: string,
    file: File,
    description?: string,
  ): Promise<ApiResponse> {
    const formData = new FormData();
    formData.append('image', file);
    if (description) formData.append('description', description);
    return apiClient(`/admin/returns/${returnId}/qc-evidence`, {
      method: 'POST',
      body: formData,
    });
  },

  submitQcDecision(
    returnId: string,
    payload: SubmitQcDecisionPayload,
  ): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/qc-decision`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  initiateRefund(
    returnId: string,
    refundMethod?: RefundMethod,
  ): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/initiate-refund`, {
      method: 'PATCH',
      body: JSON.stringify({ refundMethod }),
    });
  },

  confirmRefund(
    returnId: string,
    payload: ConfirmRefundPayload,
  ): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/confirm-refund`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  markRefundFailed(returnId: string, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/mark-refund-failed`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  retryRefund(returnId: string): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/retry-refund`, {
      method: 'PATCH',
    });
  },

  closeReturn(returnId: string): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/close`, {
      method: 'PATCH',
    });
  },

  getAnalyticsSummary(
    fromDate?: string,
    toDate?: string,
  ): Promise<ApiResponse<ReturnsAnalyticsSummary>> {
    const qs = buildQuery({ fromDate, toDate });
    return apiClient<ReturnsAnalyticsSummary>(
      `/admin/returns/analytics/summary${qs}`,
    );
  },

  getAnalyticsTrend(
    fromDate: string,
    toDate: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ): Promise<ApiResponse<ReturnsTrendPoint[]>> {
    const qs = buildQuery({ fromDate, toDate, groupBy });
    return apiClient<ReturnsTrendPoint[]>(
      `/admin/returns/analytics/trend${qs}`,
    );
  },

  getTopReasons(
    limit = 10,
    fromDate?: string,
    toDate?: string,
  ): Promise<ApiResponse<TopReasonItem[]>> {
    const qs = buildQuery({ limit, fromDate, toDate });
    return apiClient<TopReasonItem[]>(
      `/admin/returns/analytics/top-reasons${qs}`,
    );
  },
};
