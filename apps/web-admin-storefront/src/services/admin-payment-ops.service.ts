import { apiClient, ApiResponse } from '@/lib/api-client';

export type PaymentAttemptKind =
  | 'CREATE_ORDER'
  | 'CAPTURE'
  | 'VERIFY_SIGNATURE'
  | 'REFUND';
export type PaymentAttemptStatus = 'SUCCESS' | 'FAILURE';
export type PaymentMismatchKind =
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'DUPLICATE_PAYMENT'
  | 'ORPHAN_PAYMENT'
  | 'SIGNATURE_INVALID';
export type PaymentMismatchStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'IGNORED';

export interface PaymentMismatchAlert {
  id: string;
  kind: PaymentMismatchKind;
  status: PaymentMismatchStatus;
  severity: number;
  masterOrderId: string | null;
  orderNumber: string | null;
  providerPaymentId: string | null;
  expectedInPaise: number | null;
  actualInPaise: number | null;
  description: string;
  resolutionNotes: string | null;
  resolvedByAdminId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAttempt {
  id: string;
  masterOrderId: string | null;
  orderNumber: string | null;
  kind: PaymentAttemptKind;
  status: PaymentAttemptStatus;
  provider: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerRefundId: string | null;
  amountInPaise: number | null;
  currency: string;
  responseSummary: string | null;
  failureReason: string | null;
  attemptNumber: number;
  createdAt: string;
}

export interface AlertListPage {
  items: PaymentMismatchAlert[];
  page: number;
  limit: number;
  total: number;
}

export interface PaymentOpsMetrics {
  since: string;
  attempts: Array<{
    day: string;
    kind: PaymentAttemptKind;
    status: PaymentAttemptStatus;
    count: number;
  }>;
  alerts: Array<{
    day: string;
    kind: PaymentMismatchKind;
    count: number;
  }>;
}

export const adminPaymentOpsService = {
  listAlerts(filter: {
    page?: number;
    limit?: number;
    status?: PaymentMismatchStatus | '';
    kind?: PaymentMismatchKind | '';
    search?: string;
    fromDate?: string;
    toDate?: string;
  } = {}): Promise<ApiResponse<AlertListPage>> {
    const qs = new URLSearchParams();
    qs.set('page', String(filter.page ?? 1));
    qs.set('limit', String(filter.limit ?? 20));
    if (filter.status) qs.set('status', filter.status);
    if (filter.kind) qs.set('kind', filter.kind);
    if (filter.search?.trim()) qs.set('search', filter.search.trim());
    if (filter.fromDate) qs.set('fromDate', filter.fromDate);
    if (filter.toDate) qs.set('toDate', filter.toDate);
    return apiClient<AlertListPage>(`/admin/payment-ops/alerts?${qs.toString()}`);
  },
  getAlert(id: string): Promise<ApiResponse<{ alert: PaymentMismatchAlert; attempts: PaymentAttempt[] }>> {
    return apiClient(`/admin/payment-ops/alerts/${id}`);
  },
  transitionAlert(
    id: string,
    payload: { status: PaymentMismatchStatus; notes?: string },
  ): Promise<ApiResponse<PaymentMismatchAlert>> {
    return apiClient<PaymentMismatchAlert>(`/admin/payment-ops/alerts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  attemptsForOrder(masterOrderId: string): Promise<ApiResponse<PaymentAttempt[]>> {
    return apiClient<PaymentAttempt[]>(`/admin/payment-ops/orders/${masterOrderId}/attempts`);
  },
  metrics(days = 7): Promise<ApiResponse<PaymentOpsMetrics>> {
    return apiClient<PaymentOpsMetrics>(`/admin/payment-ops/metrics?days=${days}`);
  },
};

export const STATUS_COLOR: Record<PaymentMismatchStatus, string> = {
  OPEN: '#b91c1c',
  IN_REVIEW: '#d97706',
  RESOLVED: '#15803d',
  IGNORED: '#7A828F',
};

export const KIND_LABEL: Record<PaymentMismatchKind, string> = {
  AMOUNT_MISMATCH: 'Amount mismatch',
  CURRENCY_MISMATCH: 'Currency mismatch',
  DUPLICATE_PAYMENT: 'Duplicate payment',
  ORPHAN_PAYMENT: 'Orphan payment',
  SIGNATURE_INVALID: 'Invalid signature',
};

export function inrFromPaise(p: number | null): string {
  if (p == null) return '—';
  return '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
