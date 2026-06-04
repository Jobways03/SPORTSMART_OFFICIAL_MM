import { apiClient, ApiResponse } from '@/lib/api-client';

export type AffiliatePayoutStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'REJECTED';

export interface AffiliatePayoutRow {
  id: string;
  affiliateId: string;
  affiliate?: { firstName?: string | null; lastName?: string | null; email?: string | null };
  grossAmount: string;
  reversalDebit: string;
  tdsAmount: string;
  netAmount: string;
  status: AffiliatePayoutStatus;
  financialYear: string;
  payoutMethodType?: string | null;
  requestedAt: string;
  approvedAt?: string | null;
  paidAt?: string | null;
  transactionRef?: string | null;
  failureReason?: string | null;
  rejectionReason?: string | null;
}

export interface AffiliatePayoutList {
  requests: AffiliatePayoutRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const BASE = '/admin/affiliates/payouts';

export const adminAffiliatePayoutsService = {
  list(params: { status?: string; page?: number }): Promise<ApiResponse<AffiliatePayoutList>> {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.page) q.set('page', String(params.page));
    const qs = q.toString();
    return apiClient<AffiliatePayoutList>(`${BASE}${qs ? `?${qs}` : ''}`);
  },

  approve(id: string): Promise<ApiResponse<AffiliatePayoutRow>> {
    return apiClient<AffiliatePayoutRow>(`${BASE}/${id}/approve`, { method: 'PATCH' });
  },

  reject(id: string, reason: string): Promise<ApiResponse<AffiliatePayoutRow>> {
    return apiClient<AffiliatePayoutRow>(`${BASE}/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  // Phase 155 — UTR is required server-side; an idempotency key makes a
  // double-click on the money-out action replay-safe.
  markPaid(id: string, transactionRef: string): Promise<ApiResponse<AffiliatePayoutRow>> {
    const key =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return apiClient<AffiliatePayoutRow>(`${BASE}/${id}/mark-paid`, {
      method: 'PATCH',
      body: JSON.stringify({ transactionRef }),
      headers: { 'X-Idempotency-Key': key },
    });
  },

  markFailed(id: string, reason: string): Promise<ApiResponse<AffiliatePayoutRow>> {
    return apiClient<AffiliatePayoutRow>(`${BASE}/${id}/mark-failed`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  // Phase 159e — §194-O quarterly TDS report (Form 26Q roll-up).
  tds194oReport(quarter: string): Promise<ApiResponse<Tds194OReport>> {
    return apiClient<Tds194OReport>(`${BASE}/tds-194o-report?quarter=${encodeURIComponent(quarter)}`);
  },

  // Phase 159f — §194-O ledger rows for a quarter (deposit/cert ops selection).
  tdsLedger(quarter: string, status?: string): Promise<ApiResponse<Tds194OLedgerRow[]>> {
    const q = new URLSearchParams({ quarter });
    if (status) q.set('status', status);
    return apiClient<Tds194OLedgerRow[]>(`${BASE}/tds-ledger?${q.toString()}`);
  },

  markTdsDeposited(ledgerIds: string[], challanReference: string): Promise<ApiResponse<{ flipped: number }>> {
    return apiClient<{ flipped: number }>(`${BASE}/tds/mark-deposited`, {
      method: 'PATCH',
      body: JSON.stringify({ ledgerIds, challanReference }),
    });
  },

  markTdsCertificateIssued(ledgerIds: string[], certificateNumber: string): Promise<ApiResponse<{ flipped: number }>> {
    return apiClient<{ flipped: number }>(`${BASE}/tds/mark-certificate-issued`, {
      method: 'PATCH',
      body: JSON.stringify({ ledgerIds, certificateNumber }),
    });
  },

  // Phase 160 (§194-O affiliate audit #16) — correction flow. Reverse a
  // single ledger row with a reason (gated on affiliates.tax.reverse).
  reverseTds(
    ledgerId: string,
    reason: string,
  ): Promise<ApiResponse<{ reversed: boolean; previousStatus: string; wasAlreadyReversed: boolean }>> {
    return apiClient(`${BASE}/tds/${encodeURIComponent(ledgerId)}/reverse`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },
};

export interface Tds194OLedgerRow {
  id: string;
  affiliateId: string;
  affiliateName: string;
  filingPeriod: string;
  status: 'COMPUTED' | 'WITHHELD' | 'DEPOSITED' | 'CERTIFICATE_ISSUED' | 'REVERSED';
  panLast4: string | null;
  tdsRateBps: number;
  grossInPaise: string;
  tdsInPaise: string;
  challanReference: string | null;
  certificateNumber: string | null;
}

export interface Tds194OReportRow {
  affiliateId: string;
  affiliateName: string;
  email: string | null;
  panLast4: string | null;
  hadPanOnFile: boolean;
  tdsRateBps: number | null;
  payoutCount: number;
  grossInPaise: string;
  tdsInPaise: string;
}

export interface Tds194OReport {
  filingPeriod: string;
  rows: Tds194OReportRow[];
  totals: { grossInPaise: string; tdsInPaise: string; affiliates: number };
}

export const AFFILIATE_PAYOUT_STATUS_COLOR: Record<AffiliatePayoutStatus, { bg: string; fg: string }> = {
  REQUESTED: { bg: '#fef3c7', fg: '#92400e' },
  APPROVED: { bg: '#dbeafe', fg: '#1d4ed8' },
  PROCESSING: { bg: '#e0e7ff', fg: '#4338ca' },
  PAID: { bg: '#dcfce7', fg: '#166534' },
  FAILED: { bg: '#fee2e2', fg: '#991b1b' },
  CANCELLED: { bg: '#f3f4f6', fg: '#6b7280' },
  REJECTED: { bg: '#fee2e2', fg: '#b91c1c' },
};
