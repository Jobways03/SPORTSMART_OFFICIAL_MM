import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

// Mirrors the AuditLog row shape. `payload` is opaque JSON — the row
// writer picked the schema, so we keep it untyped at the FE.
export interface AuditLogRow {
  id: string;
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
  action?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

// Phase 8 verify-fast response shape. `breaks[]` lists rows whose
// stored hash didn't match a recomputed hash — empty means healthy.
export interface VerifyChainFastResponse {
  scanned: number;
  fromAnchorAt: string | null;
  breaks: Array<{ id: string; createdAt: string }>;
}

function buildQs(filters: AuditLogFilters): string {
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

  // CSV export — bearer-token endpoint won't accept a bare `<a download>`
  // because we need the Authorization header, so we fetch + blob and
  // trigger the download programmatically. Same pattern admin-analytics
  // uses for its sales/products reports.
  async downloadCsv(filters: AuditLogFilters = {}): Promise<void> {
    const qs = buildQs(filters);
    const token =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('adminAccessToken')
        : null;
    const url = `${API_BASE}/api/v1/admin/audit/export.csv${qs}`;
    const res = await fetch(url, {
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
    const match = /filename="?([^"]+)"?/i.exec(disposition);
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
