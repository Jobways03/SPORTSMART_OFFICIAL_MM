import { apiClient, ApiResponse } from '@/lib/api-client';

export type ReconciliationKind =
  | 'PAYMENT'
  | 'COD'
  | 'SETTLEMENT'
  | 'REFUND'
  | 'WALLET'
  // Phase 173 (#5) — expanded coverage.
  | 'AFFILIATE_PAYOUT'
  | 'COMMISSION'
  | 'TDS'
  | 'TCS';

// Phase 173 (#1/#14) — async lifecycle + partial success.
export type ReconciliationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED';

export type DiscrepancyKind =
  | 'EXPECTED_NOT_FOUND'
  | 'UNEXPECTED_RECORD'
  | 'AMOUNT_MISMATCH'
  | 'STATUS_MISMATCH'
  // Phase 173 (#7) — granular kinds.
  | 'MISSING_PAYMENT'
  | 'DUPLICATE_PAYMENT'
  | 'MISSING_REFUND'
  | 'DUPLICATE_REFUND'
  | 'MISSING_UTR'
  | 'PROVIDER_REFERENCE_MISSING'
  | 'SETTLEMENT_MISMATCH'
  | 'ORPHAN_LEDGER_ENTRY';

// Phase 173 (#18) — explicit triage state.
export type DiscrepancyStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'IGNORED';

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
  // Phase 173 — human-readable id + async queued timestamp.
  runNumber: string | null;
  queuedAt: string;
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
  // Phase 173 (#9/#8) — persisted drift + triage priority.
  differenceInPaise: number | null;
  severity: number;
  description: string;
  suggestedAction: string | null;
  resolutionNotes: string | null;
  resolvedByAdminId: string | null;
  resolvedAt: string | null;
  // Phase 174 (#1) — investigation-phase ownership (IN_REVIEW = the spec's
  // INVESTIGATING state).
  investigatingByAdminId: string | null;
  investigatingAt: string | null;
  // Phase 174 (#6) — triage ownership.
  assignedToAdminId: string | null;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Phase 174 (#2) — one entry in a discrepancy's immutable transition trail.
export interface DiscrepancyHistoryEntry {
  id: string;
  discrepancyId: string;
  fromStatus: DiscrepancyStatus | null;
  toStatus: DiscrepancyStatus;
  actorAdminId: string | null;
  actorRole: string | null;
  notes: string | null;
  occurredAt: string;
}

export interface BulkTransitionResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
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

  // Phase 173 (#1) — async: returns the QUEUED run handle immediately.
  startRun(payload: {
    kind: ReconciliationKind;
    periodStart: string;
    periodEnd: string;
  }): Promise<ApiResponse<{ runId: string; runNumber: string | null; status: ReconciliationStatus }>> {
    return apiClient('/admin/reconciliation/runs', {
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

  // Phase 174 (#8) — reopen a resolved/ignored discrepancy (reason required).
  reopenDiscrepancy(
    id: string,
    payload: { reason: string },
  ): Promise<ApiResponse<ReconciliationDiscrepancy>> {
    return apiClient(`/admin/reconciliation/discrepancies/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Phase 174 (#6) — assign (omit assignedToAdminId to self-assign) / unassign
  // (pass null).
  assignDiscrepancy(
    id: string,
    payload: { assignedToAdminId?: string | null },
  ): Promise<ApiResponse<ReconciliationDiscrepancy>> {
    return apiClient(`/admin/reconciliation/discrepancies/${id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // Phase 174 (#11) — bulk status transition.
  bulkTransition(payload: {
    ids: string[];
    status: DiscrepancyStatus;
    notes?: string;
  }): Promise<ApiResponse<BulkTransitionResult>> {
    return apiClient('/admin/reconciliation/discrepancies/bulk-transition', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Phase 174 (#2) — the transition timeline for the detail-page history panel.
  getDiscrepancyHistory(
    id: string,
  ): Promise<ApiResponse<DiscrepancyHistoryEntry[]>> {
    return apiClient(`/admin/reconciliation/discrepancies/${id}/history`);
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
  AFFILIATE_PAYOUT: 'Affiliate payout',
  COMMISSION: 'Commission',
  TDS: 'TDS (§194-O)',
  TCS: 'TCS (§52)',
};

export const STATUS_COLOR: Record<ReconciliationStatus, string> = {
  QUEUED: '#a855f7',
  RUNNING: '#0ea5e9',
  COMPLETED: '#16a34a',
  PARTIAL: '#d97706',
  FAILED: '#dc2626',
};

export const DISCREPANCY_STATUS_COLOR: Record<DiscrepancyStatus, string> = {
  OPEN: '#dc2626',
  IN_REVIEW: '#d97706',
  RESOLVED: '#16a34a',
  IGNORED: '#6b7280',
};

/** Phase 173 (#8) — severity → colour band for the triage UI. */
export function severityColor(sev: number): string {
  if (sev >= 80) return '#dc2626';
  if (sev >= 60) return '#d97706';
  if (sev >= 40) return '#ca8a04';
  return '#6b7280';
}

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
