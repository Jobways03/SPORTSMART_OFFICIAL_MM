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

export interface ReturnItem {
  id: string;
  orderItemId: string;
  quantity: number;
  reasonCategory: string;
  reasonDetail?: string | null;
  qcOutcome?: QcOutcome | null;
  qcQuantityApproved?: number | null;
  qcNotes?: string | null;
  refundAmount?: string | number | null;
  orderItem?: {
    id: string;
    productTitle?: string;
    variantTitle?: string | null;
    sku?: string | null;
    imageUrl?: string | null;
    unitPrice?: string | number | null;
    quantity?: number;
  } | null;
}

export interface ReturnListItem {
  id: string;
  returnNumber: string;
  subOrderId: string;
  masterOrderId: string;
  customerId: string;
  status: ReturnStatus;
  initiatedBy: string;
  pickupScheduledAt?: string | null;
  receivedAt?: string | null;
  qcDecision?: QcOutcome | null;
  refundAmount?: string | number | null;
  refundProcessedAt?: string | null;
  refundAttempts?: number;
  refundFailureReason?: string | null;
  customerNotes?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: ReturnItem[];
  subOrder?: {
    id: string;
    fulfillmentStatus?: string;
    fulfillmentNodeType?: string;
    sellerId?: string | null;
    masterOrder?: { id: string; orderNumber: string };
  };
  customer?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  masterOrder?: { id: string; orderNumber: string };
}

export interface ReturnDetail extends ReturnListItem {
  items: ReturnItem[];
  evidence: Array<{
    id: string;
    uploadedBy: string;
    fileUrl: string;
    description?: string | null;
    createdAt: string;
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus?: ReturnStatus | null;
    toStatus: ReturnStatus;
    changedBy: string;
    notes?: string | null;
    createdAt: string;
  }>;
  pickupAddress?: Record<string, unknown> | null;
  rejectionReason?: string | null;
  refundMethod?: string | null;
  refundReference?: string | null;
  qcNotes?: string | null;
}

export interface ReturnListResponse {
  returns: ReturnListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ListReturnsParams {
  page?: number;
  limit?: number;
  status?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

export const adminReturnsService = {
  listReturns(params: ListReturnsParams = {}): Promise<ApiResponse<ReturnListResponse>> {
    return apiClient<ReturnListResponse>(`/admin/returns${buildQuery(params)}`);
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

  markReceived(returnId: string, notes?: string): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/mark-received`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });
  },

  schedulePickup(
    returnId: string,
    payload: {
      pickupScheduledAt: string;
      pickupTrackingNumber?: string;
      pickupCourier?: string;
    },
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

  submitQcDecision(
    returnId: string,
    payload: {
      decisions: Array<{
        returnItemId: string;
        qcOutcome: QcOutcome;
        qcQuantityApproved: number;
        qcNotes?: string;
      }>;
      overallNotes?: string;
    },
  ): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/qc-decision`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  initiateRefund(
    returnId: string,
    refundMethod?: string,
  ): Promise<ApiResponse> {
    return apiClient(`/admin/returns/${returnId}/initiate-refund`, {
      method: 'PATCH',
      body: JSON.stringify({ refundMethod }),
    });
  },

  confirmRefund(
    returnId: string,
    payload: { refundReference: string; refundMethod?: string; notes?: string },
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
    return apiClient(`/admin/returns/${returnId}/close`, { method: 'PATCH' });
  },
};
