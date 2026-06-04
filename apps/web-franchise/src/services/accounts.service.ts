// Phase 177 (Per-Franchise Accounts audit #4) — the franchise's self-view of
// its own finances. Backed by /franchise/accounts/* (FranchiseAuthGuard +
// req.franchiseId on the server, so it can only ever return THIS franchise's
// data). Money arrives as exact 2-decimal rupee STRINGS — format with formatINR.

import { apiClient, ApiResponse } from '@/lib/api-client';

export interface FranchiseAccountsOverview {
  currency: string;
  franchise: { id: string; code: string; name: string; gstin: string | null; pan: string | null; status: string; warehousePincode: string | null };
  period: { from: string | null; to: string | null };
  revenue: { onlineRevenue: string; posGross: string; posReturns: string; posNet: string; totalRevenue: string };
  procurement: { totalProcuredValue: string; procurementFees: string; procurementCount: number; note: string };
  platformMargin: { online: string; procurement: string; total: string };
  pos: { saleCount: number; voidedCount: number; returnCount: number };
  payable: { pendingCount: number; pendingAmount: string; paidCount: number; paidAmount: string; lastSettledOn: string | null };
  overdue: { count: number; amount: string }; // Phase 178 #18 — past-SLA exposure
  reversals: { count: number; baseAmount: string; platformEarning: string };
  adjustments: { count: number; totalAmount: string };
  reconciliation: { openDiscrepancies: number; resolvedDiscrepancies: number };
  linkSources: { ledgerCsvUrl: string; settlementsUrl: string };
}

export interface FranchiseLedgerEntries {
  total: number;
  page: number;
  limit: number;
  entries: Array<{
    id: string;
    sourceType: string;
    sourceId: string;
    status: string;
    baseAmount: string;
    platformEarning: string;
    franchiseEarning: string;
    createdAt: string;
  }>;
}

export interface FranchisePosSales {
  total: number;
  page: number;
  limit: number;
  sales: Array<{
    id: string;
    saleType: string;
    status: string;
    grossAmount: string;
    netAmount: string;
    voided: boolean;
    soldAt: string;
  }>;
}

export interface FranchiseSettlementsList {
  total: number;
  page: number;
  limit: number;
  settlements: Array<{
    id: string;
    cycleId: string;
    status: string;
    netPayableToFranchise: string;
    totalPlatformEarning: string;
    paymentReference: string | null; // Phase 178 #15
    payoutDueBy: string | null; // Phase 178 #15
    paidAt: string | null;
    createdAt: string;
  }>;
}

function rangeQs(fromDate?: string, toDate?: string): string {
  const qs = new URLSearchParams();
  if (fromDate) qs.set('fromDate', fromDate);
  if (toDate) qs.set('toDate', toDate);
  const s = qs.toString();
  return s ? `?${s}` : '';
}
function pageQs(opts: { page?: number; limit?: number; fromDate?: string; toDate?: string }): string {
  const qs = new URLSearchParams();
  qs.set('page', String(opts.page ?? 1));
  qs.set('limit', String(opts.limit ?? 20));
  if (opts.fromDate) qs.set('fromDate', opts.fromDate);
  if (opts.toDate) qs.set('toDate', opts.toDate);
  return `?${qs.toString()}`;
}

export const franchiseAccountsService = {
  getOverview(fromDate?: string, toDate?: string): Promise<ApiResponse<FranchiseAccountsOverview>> {
    return apiClient<FranchiseAccountsOverview>(`/franchise/accounts/overview${rangeQs(fromDate, toDate)}`);
  },
  getLedger(opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {}): Promise<ApiResponse<FranchiseLedgerEntries>> {
    return apiClient<FranchiseLedgerEntries>(`/franchise/accounts/ledger${pageQs(opts)}`);
  },
  getPosSales(opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {}): Promise<ApiResponse<FranchisePosSales>> {
    return apiClient<FranchisePosSales>(`/franchise/accounts/pos-sales${pageQs(opts)}`);
  },
  getSettlements(opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {}): Promise<ApiResponse<FranchiseSettlementsList>> {
    return apiClient<FranchiseSettlementsList>(`/franchise/accounts/settlements${pageQs(opts)}`);
  },
};

export function formatINR(value: string | null | undefined): string {
  if (value == null || value === '') return '₹0.00';
  const n = Number(value);
  if (Number.isNaN(n)) return `₹${value}`;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
