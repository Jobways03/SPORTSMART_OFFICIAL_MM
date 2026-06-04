// Phase 181 (Franchise Ledger audit #10) — admin client for the franchise
// running-balance ledger. Money arrives as paise STRINGS (the API's BigInt
// shim) + a formatted rupee string; format paise with `paiseToINR`, never math.

import { apiClient, ApiResponse } from '@/lib/api-client';

export interface LedgerBalance {
  balanceInPaise: string;
  balance: string;
  currency: string;
  asOf: string | null;
}

export interface LedgerEntry {
  id: string;
  createdAt: string;
  sourceType: string;
  sourceId: string;
  description: string | null;
  status: string;
  debitInPaise: string;
  creditInPaise: string;
  balanceAfterInPaise: string;
  createdByAdminId: string | null;
  createdBySystem: boolean;
  currency: string;
}

export interface LedgerPage {
  entries: LedgerEntry[];
  total: number;
}

// Phase 181 (#11) — high-value penalty approval queue.
export interface PenaltyApproval {
  id: string;
  franchiseId: string;
  amount: string;
  reason: string;
  status: string;
  requestedByAdminId: string;
  approvedByAdminId: string | null;
  decisionReason: string | null;
  ledgerEntryId: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export interface PenaltyApprovalPage {
  items: PenaltyApproval[];
  total: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const adminFranchiseFinanceService = {
  getBalance(franchiseId: string, asOf?: string): Promise<ApiResponse<LedgerBalance>> {
    return apiClient<LedgerBalance>(`/admin/franchise-finance/${franchiseId}/balance${qs({ asOf })}`);
  },
  getLedger(
    franchiseId: string,
    opts: { page?: number; limit?: number; sourceType?: string; status?: string } = {},
  ): Promise<ApiResponse<LedgerPage>> {
    return apiClient<LedgerPage>(`/admin/franchise-finance/${franchiseId}/ledger${qs({ page: opts.page ?? 1, limit: opts.limit ?? 20, sourceType: opts.sourceType, status: opts.status })}`);
  },
  createAdjustment(franchiseId: string, body: { amount: number; reason: string }): Promise<ApiResponse<LedgerEntry>> {
    return apiClient(`/admin/franchise-finance/${franchiseId}/adjustment`, { method: 'POST', body: JSON.stringify(body) });
  },
  createPenalty(franchiseId: string, body: { amount: number; reason: string; coApproverAdminId?: string }): Promise<ApiResponse<LedgerEntry>> {
    return apiClient(`/admin/franchise-finance/${franchiseId}/penalty`, { method: 'POST', body: JSON.stringify(body) });
  },
  ledgerCsvUrl(franchiseId: string, opts: { sourceType?: string; status?: string; fromDate?: string; toDate?: string } = {}): string {
    return `/admin/franchise-finance/${franchiseId}/ledger/export.csv${qs(opts)}`;
  },
  listPenaltyApprovals(opts: { status?: string; franchiseId?: string; page?: number; limit?: number } = {}): Promise<ApiResponse<PenaltyApprovalPage>> {
    return apiClient<PenaltyApprovalPage>(`/admin/franchise-finance/penalty-approvals${qs({ status: opts.status, franchiseId: opts.franchiseId, page: opts.page ?? 1, limit: opts.limit ?? 25 })}`);
  },
  approvePenalty(id: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/franchise-finance/penalty-approvals/${id}/approve`, { method: 'POST' });
  },
  rejectPenalty(id: string, reason?: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/franchise-finance/penalty-approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
  },
};

// String-based (the frontend target predates BigInt literals): split the paise
// string into rupees + paise without any numeric coercion (exact at any size).
export function paiseToINR(paise: string | null | undefined): string {
  if (paise == null || paise === '') return '₹0.00';
  let s = String(paise).trim();
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (!/^\d+$/.test(s)) return `₹${paise}`;
  s = s.padStart(3, '0');
  const paisePart = s.slice(-2);
  const rupees = (s.slice(0, -2).replace(/^0+(?=\d)/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}₹${rupees}.${paisePart}`;
}
