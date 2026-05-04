import { apiClient, ApiResponse } from '@/lib/api-client';

export type ReconciliationKind =
  | 'PAYMENT'
  | 'COD'
  | 'SETTLEMENT'
  | 'REFUND'
  | 'WALLET';

export type ReconciliationStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export type DiscrepancyKind =
  | 'EXPECTED_NOT_FOUND'
  | 'UNEXPECTED_RECORD'
  | 'AMOUNT_MISMATCH'
  | 'STATUS_MISMATCH';

export type DiscrepancyStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export interface ReconciliationRun {
  id: string;
  kind: ReconciliationKind;
  status: ReconciliationStatus;
  periodStart: string;
  periodEnd: string;
  totalExpected: number;
  totalMatched: number;
  totalDiscrepancies: number;
  expectedAmountInPaise: number;
  matchedAmountInPaise: number;
  failureReason: string | null;
  startedByAdminId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ReconciliationDiscrepancy {
  id: string;
  runId: string;
  kind: DiscrepancyKind;
  status: DiscrepancyStatus;
  masterOrderId: string | null;
  orderNumber: string | null;
  externalRef: string | null;
  expectedInPaise: number | null;
  actualInPaise: number | null;
  description: string;
  resolutionNotes: string | null;
  resolvedByAdminId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface RunDetail extends ReconciliationRun {
  discrepancies: ReconciliationDiscrepancy[];
}

export interface RunListResponse {
  items: ReconciliationRun[];
  page: number;
  limit: number;
  total: number;
}

export const adminReconciliationService = {
  listRuns(filter: {
    page?: number;
    limit?: number;
    kind?: ReconciliationKind | '';
    status?: ReconciliationStatus | '';
  } = {}): Promise<ApiResponse<RunListResponse>> {
    const qs = new URLSearchParams();
    qs.set('page', String(filter.page ?? 1));
    qs.set('limit', String(filter.limit ?? 20));
    if (filter.kind) qs.set('kind', filter.kind);
    if (filter.status) qs.set('status', filter.status);
    return apiClient<RunListResponse>(
      `/admin/reconciliation/runs?${qs.toString()}`,
    );
  },

  getRun(id: string): Promise<ApiResponse<RunDetail>> {
    return apiClient<RunDetail>(`/admin/reconciliation/runs/${id}`);
  },

  startRun(payload: {
    kind: ReconciliationKind;
    periodStart: string;
    periodEnd: string;
  }): Promise<ApiResponse<ReconciliationRun>> {
    return apiClient<ReconciliationRun>('/admin/reconciliation/runs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  transitionDiscrepancy(
    id: string,
    payload: { status: DiscrepancyStatus; notes?: string },
  ): Promise<ApiResponse<ReconciliationDiscrepancy>> {
    return apiClient(`/admin/reconciliation/discrepancies/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  csvUrl(runId: string): string {
    // Returned as a path the page can wrap in a fully qualified URL
    // so the browser's <a download> works without going through
    // apiClient (which would try to JSON-parse the response).
    return `/admin/reconciliation/runs/${runId}/discrepancies.csv`;
  },
};

export const KIND_LABEL: Record<ReconciliationKind, string> = {
  PAYMENT: 'Payment',
  COD: 'COD',
  SETTLEMENT: 'Settlement',
  REFUND: 'Refund',
  WALLET: 'Wallet',
};

export const STATUS_COLOR: Record<ReconciliationStatus, string> = {
  RUNNING: '#0ea5e9',
  COMPLETED: '#16a34a',
  FAILED: '#dc2626',
};

export const DISCREPANCY_STATUS_COLOR: Record<DiscrepancyStatus, string> = {
  OPEN: '#dc2626',
  RESOLVED: '#16a34a',
  IGNORED: '#6b7280',
};

export function inrFromPaise(p: number | null): string {
  if (p == null) return '—';
  return (
    '₹' +
    (p / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
