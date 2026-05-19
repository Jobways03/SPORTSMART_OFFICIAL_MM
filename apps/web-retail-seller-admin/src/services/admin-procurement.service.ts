import { apiClient, ApiResponse } from '@/lib/api-client';

export interface ProcurementListItem {
  id: string;
  requestNumber: string;
  franchiseId: string;
  status: string;
  totalRequestedAmount: number;
  totalApprovedAmount: number;
  procurementFeeAmount: number;
  finalPayableAmount: number;
  requestedAt: string | null;
  approvedAt: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  franchise?: {
    id: string;
    businessName: string;
    franchiseCode: string;
  };
  _count?: {
    items: number;
  };
}

export interface ProcurementItem {
  id: string;
  procurementRequestId: string;
  productId: string;
  variantId: string | null;
  globalSku: string;
  productTitle: string;
  variantTitle: string | null;
  status: string;
  requestedQty: number;
  approvedQty: number;
  receivedQty: number;
  damagedQty: number;
  sourceSellerId: string | null;
  landedUnitCost: number | null;
  procurementFeePerUnit: number | null;
  finalUnitCostToFranchise: number | null;
}

export interface ProcurementDetail extends ProcurementListItem {
  items: ProcurementItem[];
  procurementFeeRate: number;
  notes: string | null;
}

export interface ProcurementListResponse {
  requests: ProcurementListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListProcurementParams {
  page?: number;
  limit?: number;
  status?: string;
  franchiseId?: string;
  search?: string;
}

export interface ApproveProcurementItem {
  itemId: string;
  approvedQty: number;
  landedUnitCost: number;
  sourceSellerId?: string;
}

export const adminProcurementService = {
  list(params: ListProcurementParams = {}): Promise<ApiResponse<ProcurementListResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    if (params.franchiseId) qs.set('franchiseId', params.franchiseId);
    if (params.search) qs.set('search', params.search);
    const query = qs.toString();
    return apiClient<ProcurementListResponse>(`/admin/procurement${query ? `?${query}` : ''}`);
  },

  get(id: string): Promise<ApiResponse<ProcurementDetail>> {
    return apiClient<ProcurementDetail>(`/admin/procurement/${id}`);
  },

  approve(id: string, items: ApproveProcurementItem[]): Promise<ApiResponse> {
    return apiClient(`/admin/procurement/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ items }),
    });
  },

  reject(id: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/procurement/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  dispatch(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/procurement/${id}/dispatch`, { method: 'PATCH' });
  },

  settle(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/procurement/${id}/settle`, { method: 'PATCH' });
  },
};

export function getProcurementStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    APPROVED: 'Approved',
    PARTIALLY_APPROVED: 'Partially Approved',
    REJECTED: 'Rejected',
    SOURCING: 'Sourcing',
    DISPATCHED: 'Dispatched',
    PARTIALLY_RECEIVED: 'Partially Received',
    RECEIVED: 'Received',
    SETTLED: 'Settled',
    CANCELLED: 'Cancelled',
  };
  return labels[status] || status;
}

export function getProcurementStatusColor(status: string): string {
  if (['REJECTED', 'CANCELLED'].includes(status)) return '#dc2626';
  if (['SETTLED', 'RECEIVED'].includes(status)) return '#16a34a';
  if (['DISPATCHED', 'SOURCING'].includes(status)) return '#2563eb';
  if (['PARTIALLY_APPROVED', 'PARTIALLY_RECEIVED'].includes(status)) return '#d97706';
  if (status === 'APPROVED') return '#0891b2';
  return '#6b7280';
}

export function getProcurementItemStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    SOURCED: 'Sourced',
    DISPATCHED: 'Dispatched',
    RECEIVED: 'Received',
    SHORT: 'Short',
    DAMAGED: 'Damaged',
  };
  return labels[status] || status;
}

export function getProcurementItemStatusColor(status: string): string {
  if (['REJECTED', 'SHORT', 'DAMAGED'].includes(status)) return '#dc2626';
  if (status === 'RECEIVED') return '#16a34a';
  if (['DISPATCHED', 'SOURCED'].includes(status)) return '#2563eb';
  if (status === 'APPROVED') return '#0891b2';
  return '#6b7280';
}

export function formatCurrency(amount: number | null | undefined): string {
  const value = typeof amount === 'number' ? amount : 0;
  return `\u20B9${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatProcurementDate(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
