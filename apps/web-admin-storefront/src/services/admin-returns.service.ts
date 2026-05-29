import { apiClient, API_BASE, ApiResponse } from '@/lib/api-client';

/** Extract the filename from a `Content-Disposition: attachment; filename="..."` header. */
function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}

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

export type LiabilityParty =
  | 'NONE'
  | 'SELLER'
  | 'LOGISTICS'
  | 'PLATFORM'
  | 'CUSTOMER'
  | 'FRANCHISE'
  | 'BRAND'
  | 'INCONCLUSIVE';

export type CustomerRemedy =
  | 'FULL_REFUND'
  | 'PARTIAL_REFUND'
  | 'NO_REFUND'
  | 'GOODWILL_CREDIT'
  | 'REPLACEMENT'
  | 'EXCHANGE';

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
  // Phase 13 — risk + replacement-flow surface for admin queue filters.
  riskScore?: number | null;
  riskFlags?: string[] | null;
  liabilityParty?: string | null;
  customerRemedy?: string | null;
  replacementStatus?: string | null;
  replacementOrderId?: string | null;
  exchangePriceDiffPaise?: string | number | null;
  sellerResponseStatus?: string | null;
  sellerRespondedAt?: string | null;
  sellerResponseNotes?: string | null;
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
  // Phase C (P0.2) — discount-aware refund preview data attached by
  // the admin getReturnByIdAdmin endpoint. Empty arrays for legacy
  // orders without per-item tax snapshots — UI falls back to the
  // gross-price refund display in that case.
  refundPreview?: {
    taxSnapshots: Array<{
      orderItemId: string;
      grossLineAmountInPaise: string;
      discountAmountInPaise: string;
      taxableAmountInPaise: string;
      gstRateBps: number;
      cgstAmountInPaise: string;
      sgstAmountInPaise: string;
      igstAmountInPaise: string;
      totalTaxAmountInPaise: string;
    }>;
    priorReversals: Array<{
      id: string;
      orderItemId: string;
      taxableReversalInPaise: string;
      totalTaxReversalInPaise: string;
      totalCreditNoteAmountInPaise: string;
    }>;
  };
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
  [key: string]: string | number | undefined;
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
      liabilityParty?: LiabilityParty;
      customerRemedy?: CustomerRemedy;
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

  // ── Bulk operations (SUPER_ADMIN only, hard-capped at 100) ──────
  bulkApprove(returnIds: string[]): Promise<ApiResponse<{ results: BulkResult[] }>> {
    return apiClient(`/admin/returns/bulk-approve`, {
      method: 'POST',
      body: JSON.stringify({ returnIds }),
    });
  },

  bulkClose(returnIds: string[]): Promise<ApiResponse<{ results: BulkResult[] }>> {
    return apiClient(`/admin/returns/bulk-close`, {
      method: 'POST',
      body: JSON.stringify({ returnIds }),
    });
  },

  // ── CSV export ─────────────────────────────────────────────────
  /**
   * Trigger a CSV download. Uses fetch (not the JSON apiClient) so we can read
   * the Blob body together with the X-Export-* / Content-Disposition headers.
   * The browser still buffers the whole file into the Blob; for large result
   * sets the server caps at 50k rows and reports `truncated` so the UI can
   * warn the operator.
   */
  async exportCsv(params: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    sellerId?: string;
    franchiseId?: string;
    qcDecision?: string;
    refundMethod?: string;
    nodeType?: string;
  } = {}): Promise<{
    blob: Blob;
    total: number | null;
    truncated: boolean;
    filename: string;
  }> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) qs.set(key, value);
    }
    const token =
      (typeof window !== 'undefined' && sessionStorage.getItem('adminAccessToken')) || '';
    const res = await fetch(
      `${API_BASE}/api/v1/admin/returns/export${qs.toString() ? `?${qs}` : ''}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Export failed (${res.status})`);
    }
    const totalHeader = res.headers.get('X-Export-Total');
    return {
      blob: await res.blob(),
      total: totalHeader != null ? Number(totalHeader) : null,
      truncated: res.headers.get('X-Export-Truncated') === 'true',
      filename:
        parseContentDispositionFilename(res.headers.get('Content-Disposition')) ||
        'returns-export.csv',
    };
  },

  // ── Customer return history ────────────────────────────────────
  getCustomerHistory(customerId: string): Promise<
    ApiResponse<{ items: ReturnListItem[]; aggregates: CustomerHistoryAggregates }>
  > {
    return apiClient(
      `/admin/returns/customers/${encodeURIComponent(customerId)}/history`,
    );
  },
};

export interface BulkResult {
  id: string;
  success: boolean;
  error?: string;
}

export interface CustomerHistoryAggregates {
  totalReturns: number;
  totalRefundedAmount: number;
  refundedCount: number;
  rejectedCount: number;
  pendingCount: number;
}
