import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

// Mirrors the AuditLog row shape. `payload` is opaque JSON — the row
// writer picked the schema, so we keep it untyped at the FE.
export interface AuditLogRow {
  id: string;
  sequenceNumber: string | null;
  module: string;
  resource: string;
  resourceId: string | null;
  action: string;
  actorId: string | null;
  actorType: string | null;
  actorRole: string | null;
  payload: unknown;
  hash: string;
  prevHash: string | null;
  createdAt: string;
}

export interface AuditLogListResponse {
  items: AuditLogRow[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogFilters {
  module?: string;
  resource?: string;
  resourceId?: string;
  actorId?: string;
  actorType?: string;
  action?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

// Phase 204 — verify response. `breaks[]` now carries the typed issue
// (issueType / severity / reason) so the UI can colour + explain each break.
export interface VerifyChainBreak {
  id: string | null;
  createdAt: string | null;
  issueType: string;
  severity: string;
  reason: string;
}
export interface VerifyChainFastResponse {
  scanned: number;
  fromAnchorAt: string | null;
  anchorSequence: number | null;
  breaks: VerifyChainBreak[];
}

// Phase 204 (#16) — persisted verification-run history.
export interface VerificationRun {
  id: string;
  runType: 'FAST' | 'FULL' | 'SAMPLE';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedBy: string | null;
  startedAt: string;
  completedAt: string | null;
  rowsChecked: number;
  issuesFound: number;
  resultSummary?: unknown;
  errorMessage?: string | null;
}
export interface VerificationRunDetail extends VerificationRun {
  issues: Array<{
    id: string;
    auditLogId: string | null;
    issueType: string;
    severity: string;
    expectedHash: string | null;
    actualHash: string | null;
    details: string | null;
    createdAt: string;
  }>;
}

// Accept any plain object of filter fields. Using `Record<string, unknown>`
// would reject a concrete interface (AuditLogFilters) because interfaces have
// no implicit string index signature; `object` + Object.entries is safe here.
function buildQs(filters: object): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const adminAuditService = {
  list(filters: AuditLogFilters = {}): Promise<ApiResponse<AuditLogListResponse>> {
    return apiClient<AuditLogListResponse>(`/admin/audit/logs${buildQs(filters)}`);
  },

  getOne(id: string): Promise<ApiResponse<AuditLogRow>> {
    return apiClient<AuditLogRow>(`/admin/audit/logs/${id}`);
  },

  verifyChainFast(limit = 10000): Promise<ApiResponse<VerifyChainFastResponse>> {
    return apiClient<VerifyChainFastResponse>(
      `/admin/audit/verify-chain-fast?limit=${limit}`,
    );
  },

  // Phase 204 (#15) — full cursor-batched walk (POST; can be slow on a large
  // chain). The backend persists a FULL run regardless.
  verifyChainFull(): Promise<ApiResponse<VerifyChainFastResponse>> {
    return apiClient<VerifyChainFastResponse>(`/admin/audit/verify-chain-full`, {
      method: 'POST',
    });
  },

  // Phase 204 (#16/#17) — verification history + drill-down.
  listVerificationRuns(limit = 50): Promise<ApiResponse<{ items: VerificationRun[] }>> {
    return apiClient<{ items: VerificationRun[] }>(
      `/admin/audit/verification-runs?limit=${limit}`,
    );
  },
  getVerificationRun(id: string): Promise<ApiResponse<VerificationRunDetail>> {
    return apiClient<VerificationRunDetail>(`/admin/audit/verification-runs/${id}`);
  },

  /**
   * CSV export — Phase 206. The endpoint is now POST, REQUIRES fromDate +
   * toDate, and caps the span (90 days) + row count (100K) server-side; the
   * default `mode` is `redacted`. We fetch + blob because the endpoint needs
   * the Authorization header.
   *
   * @throws if fromDate/toDate are missing (the backend would 400 anyway; we
   *   fail fast with a clear message).
   */
  async downloadCsv(
    filters: AuditLogFilters & { mode?: 'redacted' | 'full' },
  ): Promise<void> {
    if (!filters.fromDate || !filters.toDate) {
      throw new Error('Select a From and To date before exporting.');
    }
    const qs = buildQs({
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      mode: filters.mode ?? 'redacted',
      module: filters.module,
      resource: filters.resource,
      resourceId: filters.resourceId,
      actorId: filters.actorId,
      action: filters.action,
    });
    const token =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('adminAccessToken')
        : null;
    const url = `${API_BASE}/api/v1/admin/audit/export.csv${qs}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      let msg = `Download failed (${res.status})`;
      try {
        const json = await res.json();
        if (json?.message) msg = Array.isArray(json.message) ? json.message.join(', ') : String(json.message);
      } catch {
        /* response wasn't JSON */
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = match?.[1] ?? 'audit-log.csv';
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  },
};
