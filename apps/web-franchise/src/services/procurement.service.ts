import { apiClient } from '@/lib/api-client';

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
  landedUnitCost: number | null;
  procurementFeePerUnit: number | null;
  finalUnitCostToFranchise: number | null;
}

export interface ProcurementRequest {
  id: string;
  requestNumber: string;
  franchiseId: string;
  status: string;
  totalRequestedAmount: number;
  totalApprovedAmount: number;
  procurementFeeRate: number;
  procurementFeeAmount: number;
  finalPayableAmount: number;
  requestedAt: string | null;
  approvedAt: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  settledAt: string | null;
  notes: string | null;
  rejectionReason: string | null;
  trackingNumber: string | null;
  carrierName: string | null;
  expectedDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: ProcurementItem[];
}

export interface CreateProcurementPayload {
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
  }>;
  notes?: string;
}

export interface ConfirmReceiptPayload {
  items: Array<{
    itemId: string;
    receivedQty: number;
    damagedQty?: number;
  }>;
}

export interface ProcurementListResponse {
  requests: ProcurementRequest[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const franchiseProcurementService = {
  list(params: { page?: number; limit?: number; status?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    return apiClient<ProcurementListResponse>(
      `/franchise/procurement?${qs.toString()}`,
    );
  },
  get(id: string) {
    return apiClient<ProcurementRequest>(`/franchise/procurement/${id}`);
  },
  create(payload: CreateProcurementPayload) {
    return apiClient<ProcurementRequest>('/franchise/procurement', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  submit(id: string) {
    return apiClient(`/franchise/procurement/${id}/submit`, { method: 'POST' });
  },
  cancel(id: string, reason?: string) {
    return apiClient(`/franchise/procurement/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
  confirmReceipt(id: string, payload: ConfirmReceiptPayload) {
    return apiClient(`/franchise/procurement/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export function getProcurementStatusColor(status: string): string {
  if (['REJECTED', 'CANCELLED'].includes(status)) return '#dc2626';
  if (['SETTLED', 'RECEIVED'].includes(status)) return '#16a34a';
  if (['DISPATCHED', 'SOURCING'].includes(status)) return '#2563eb';
  if (['PARTIALLY_APPROVED', 'PARTIALLY_RECEIVED'].includes(status)) return '#d97706';
  if (status === 'APPROVED') return '#0891b2';
  if (status === 'SUBMITTED') return '#7c3aed';
  return '#6b7280'; // DRAFT
}

export function getProcurementStatusLabel(status: string): string {
  return (
    {
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
    }[status] || status
  );
}

export function formatProcurementCurrency(amount: number | null | undefined): string {
  const value = typeof amount === 'number' ? amount : 0;
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatProcurementDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}
