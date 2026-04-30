import { apiClient, ApiResponse } from '@/lib/api-client';

export interface AdminProcurementItem {
  id: string;
  procurementRequestId: string;
  productId: string;
  variantId: string | null;
  globalSku: string;
  requestedQty: number;
  approvedQty: number;
  dispatchedQty: number;
  receivedQty: number;
  damagedQty: number;
  landedUnitCost: number | string | null;
  procurementFeePerUnit: number | string | null;
  finalUnitCostToFranchise: number | string | null;
  status: string;
  product?: { title?: string } | null;
  variant?: { title?: string | null } | null;
}

export interface AdminProcurementRequest {
  id: string;
  requestNumber: string;
  franchiseId: string;
  franchiseCode?: string | null;
  status: string;
  requestedAt: string | null;
  approvedAt: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  rejectionReason: string | null;
  trackingNumber: string | null;
  carrierName: string | null;
  expectedDeliveryAt: string | null;
  procurementFeeRate: number | string;
  totalApprovedAmount: number | string;
  procurementFeeAmount: number | string;
  finalPayableAmount: number | string;
  createdAt: string;
  items: AdminProcurementItem[];
  franchise?: {
    id: string;
    franchiseCode?: string;
    businessName?: string;
    ownerName?: string;
  } | null;
}

export interface AdminProcurementListResponse {
  requests: AdminProcurementRequest[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApproveItemInput {
  itemId: string;
  approvedQty: number;
  landedUnitCost: number;
}

export const adminProcurementService = {
  list(params: {
    page?: number;
    limit?: number;
    status?: string;
    franchiseId?: string;
    search?: string;
  } = {}): Promise<ApiResponse<AdminProcurementListResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    if (params.franchiseId) query.set('franchiseId', params.franchiseId);
    if (params.search) query.set('search', params.search);
    const qs = query.toString();
    return apiClient<AdminProcurementListResponse>(
      `/admin/procurement${qs ? `?${qs}` : ''}`,
    );
  },

  get(id: string): Promise<ApiResponse<AdminProcurementRequest>> {
    return apiClient<AdminProcurementRequest>(`/admin/procurement/${id}`);
  },

  approve(id: string, items: ApproveItemInput[]): Promise<ApiResponse> {
    return apiClient(`/admin/procurement/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ items }),
    });
  },

  reject(id: string, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/procurement/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  dispatch(
    id: string,
    shipment: {
      trackingNumber?: string;
      carrierName?: string;
      expectedDeliveryAt?: string;
    } = {},
  ): Promise<ApiResponse> {
    return apiClient(`/admin/procurement/${id}/dispatch`, {
      method: 'PATCH',
      body: JSON.stringify(shipment),
    });
  },

  settle(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/procurement/${id}/settle`, { method: 'PATCH' });
  },
};

export const PROCUREMENT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'SOURCING',
  'DISPATCHED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'SETTLED',
  'CANCELLED',
] as const;

export function statusPalette(
  status: string,
): { bg: string; color: string } {
  const m: Record<string, { bg: string; color: string }> = {
    DRAFT: { bg: '#f3f4f6', color: '#374151' },
    SUBMITTED: { bg: '#fef3c7', color: '#92400e' },
    APPROVED: { bg: '#dbeafe', color: '#1e40af' },
    PARTIALLY_APPROVED: { bg: '#dbeafe', color: '#1e40af' },
    REJECTED: { bg: '#fee2e2', color: '#b91c1c' },
    SOURCING: { bg: '#ede9fe', color: '#6d28d9' },
    DISPATCHED: { bg: '#cffafe', color: '#0e7490' },
    PARTIALLY_RECEIVED: { bg: '#fde68a', color: '#92400e' },
    RECEIVED: { bg: '#dcfce7', color: '#15803d' },
    SETTLED: { bg: '#dcfce7', color: '#166534' },
    CANCELLED: { bg: '#f3f4f6', color: '#6b7280' },
  };
  return m[status] ?? { bg: '#f3f4f6', color: '#6b7280' };
}
