// Phase 176 (Per-Seller Accounts audit #4) — the seller's self-view of their
// own finances. Backed by /seller/accounts/* (SellerAuthGuard + req.sellerId on
// the server, so it can only ever return THIS seller's data). Money arrives as
// exact 2-decimal rupee STRINGS — format with `formatINR`, never parse to math.

import { apiClient, ApiResponse } from '@/lib/api-client';

export interface SellerAccountsOverview {
  currency: string;
  seller: { id: string; name: string; gstin: string | null; pan: string | null; status: string };
  period: { from: string | null; to: string | null };
  revenue: { gross: string; refundsDeducted: string; net: string; taxExcluded: string };
  margin: { platformMargin: string; marginPercentage: number };
  commission: { recordCount: number; statusBreakdown: Record<string, number>; totalSettlementAmount: string };
  payable: { pendingCount: number; pendingAmount: string; paidCount: number; paidAmount: string; lastSettledOn: string | null };
  overdue: { count: number; amount: string }; // Phase 178 #18 — past-SLA exposure
  taxDeductions: { tdsDeducted: string; tdsRowCount: number; tdsDepositedCount: number; tcsCollected: string; tcsRowCount: number; note: string };
  adjustments: { count: number; totalAmount: string };
  reversals: { count: number; refundedAdminEarning: string };
  reconciliation: { openDiscrepancies: number; resolvedDiscrepancies: number };
  linkSources: Record<string, string>;
}

export interface SellerCommissionRecords {
  total: number;
  page: number;
  limit: number;
  records: Array<{
    id: string;
    orderNumber: string;
    productTitle: string;
    status: string;
    totalPlatformAmount: string;
    platformMargin: string;
    createdAt: string;
  }>;
}

export interface SellerSettlementsList {
  total: number;
  page: number;
  limit: number;
  settlements: Array<{
    id: string;
    cycleId: string;
    status: string;
    totalSettlementAmount: string;
    totalPlatformMargin: string;
    utrReference: string | null;
    paymentFailureReason: string | null; // Phase 178 #15
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

export const accountsService = {
  getOverview(fromDate?: string, toDate?: string): Promise<ApiResponse<SellerAccountsOverview>> {
    return apiClient<SellerAccountsOverview>(`/seller/accounts/overview${rangeQs(fromDate, toDate)}`);
  },
  getCommissionRecords(
    opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {},
  ): Promise<ApiResponse<SellerCommissionRecords>> {
    return apiClient<SellerCommissionRecords>(`/seller/accounts/commission-records${pageQs(opts)}`);
  },
  getSettlements(
    opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {},
  ): Promise<ApiResponse<SellerSettlementsList>> {
    return apiClient<SellerSettlementsList>(`/seller/accounts/settlements${pageQs(opts)}`);
  },
};

export function formatINR(value: string | null | undefined): string {
  if (value == null || value === '') return '₹0.00';
  const n = Number(value);
  if (Number.isNaN(n)) return `₹${value}`;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
