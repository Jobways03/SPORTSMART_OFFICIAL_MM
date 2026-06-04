import { apiClient, ApiResponse } from '@/lib/api-client';

// Phase 175 (Accounts Overview audit) — money values arrive as EXACT 2-decimal
// rupee STRINGS (never JS Number); format with `formatINR` for display.

export interface PlatformOverview {
  currency: string;
  totalPlatformRevenue: string;
  totalRefundedFromCommission: string;
  netPlatformRevenue: string;
  totalTaxOnCommission: string;
  totalPlatformCommissions: string;
  totalPlatformEarnings: string;
  totalSellerCommission: string;
  totalFranchiseCommission: string;
  totalProcurementFees: string;
  totalAffiliateCommissionPaid: string;
  totalSellerPayables: string;
  totalFranchisePayables: string;
  pendingSellerSettlements: number;
  pendingFranchiseSettlements: number;
  totalSettledToSellers: string;
  totalSettledToFranchises: string;
  chargebackExposure: string;
  linkSources: {
    sellerSettlementsUrl: string;
    franchiseSettlementsUrl: string;
    commissionRecordsUrl: string;
    refundApprovalsUrl: string;
  };
}

export interface SellerOverview {
  currency: string;
  totalSellers: number;
  activeSellers: number;
  totalCommissionRecords: number;
  totalPlatformAmount: string;
  totalSettlementAmount: string;
  totalPlatformMargin: string;
  totalRefundedFromCommission: string;
  pendingSettlementAmount: string;
  settledAmount: string;
}

export interface FranchiseOverview {
  currency: string;
  totalFranchises: number;
  activeFranchises: number;
  totalLedgerEntries: number;
  totalOnlineOrderCommission: string;
  totalProcurementFees: string;
  totalFranchiseEarnings: string;
  pendingSettlementAmount: string;
  settledAmount: string;
}

export interface OutstandingPayables {
  currency: string;
  sellerOutstanding: { count: number; amount: string };
  franchiseOutstanding: { count: number; amount: string };
  totalOutstanding: string;
  oldestUnpaidDate: string | null;
  // Phase 178 — aging buckets + frozen/failed.
  aging: {
    buckets: Array<{ bucket: string; severity: string | null; count: number; amount: string }>;
    overdue: { count: number; amount: string };
  };
  frozen: { count: number };
  failed: { count: number };
}

export type RankMetric = 'REVENUE' | 'MARGIN';
export type RankNodeType = 'SELLER' | 'FRANCHISE' | 'ALL';

// Phase 180 — reports.
export type MarginDateBasis = 'created' | 'settled';
export type ReportNodeType = 'SELLER' | 'FRANCHISE' | 'ALL';
export type PayoutNodeType = 'SELLER' | 'FRANCHISE' | 'AFFILIATE' | 'ALL';

export interface RevenueRow {
  period: string;
  totalRevenue: string;
  refunds: string;
  netRevenue: string;
  sellerFulfilledAmount: string;
  franchiseFulfilledAmount: string;
  platformCommissionMargin: string;
}
export interface MarginNodeRow {
  nodeType: 'SELLER' | 'FRANCHISE';
  nodeId: string;
  nodeName: string;
  totalRecords: number;
  totalRevenue: string;
  totalPayable: string;
  platformMargin: string;
  marginPercentage: number;
}
export interface MarginReport {
  period: { fromDate: string; toDate: string };
  dateBasis: MarginDateBasis;
  nodeType: ReportNodeType;
  summary: { totalPlatformMargin: string; totalSellerMargin: string; totalFranchiseMargin: string };
  revenueBasis: { sellers: string; franchises: string };
  methodology: string;
  sellers: MarginNodeRow[];
  franchises: MarginNodeRow[];
}
export interface PayoutRow {
  nodeType: 'SELLER' | 'FRANCHISE' | 'AFFILIATE';
  settlementId: string;
  nodeId: string;
  nodeName: string;
  status: string;
  grossAmount: string;
  tcsDeducted: string;
  tdsDeducted: string;
  commissionGst: string;
  netAmountPaid: string;
  platformMargin: string;
  paidAt: string | null;
  paymentReference: string | null;
  cycleId: string | null;
  cyclePeriod: string | null;
}
export interface PayoutReport {
  period: { fromDate: string; toDate: string };
  nodeType: string;
  summary: { totalNetPaidOut: string; totalSellerPayouts: string; totalFranchisePayouts: string; totalAffiliatePayouts: string; sellerPayoutCount: number; franchisePayoutCount: number; affiliatePayoutCount: number };
  note: string;
  sellerPayouts: PayoutRow[];
  franchisePayouts: PayoutRow[];
  affiliatePayouts: PayoutRow[];
}
export interface ReconciliationReport {
  period: { fromDate: string | null; toDate: string | null; note?: string };
  seller: { totalPlatformRevenue: string; totalPlatformMargin: string; totalCommissionRecords: number; pendingSettlements: { count: number; amount: string }; settledPayments: { count: number; amount: string } };
  franchise: { totalBaseAmount: string; totalPlatformEarning: string; totalFranchiseEarning: string; totalLedgerEntries: number; pendingSettlements: { count: number; amount: string }; settledPayments: { count: number; amount: string } };
  combined: { totalPlatformEarnings: string; totalPayableOutstanding: string; totalPaid: string };
  integrityChecks: { settledCommissionMargin: string; paidSettlementMargin: string; orphanedSettledCommissions: number };
  isReconciled: boolean;
  mismatches: string[];
}

export interface TopPerformers {
  topSellers: Array<{
    rank: number;
    sellerId: string;
    sellerName: string;
    totalOrders: number;
    totalRevenue: string;
    platformMargin: string;
    marginPercentage: number;
  }>;
  topFranchises: Array<{
    rank: number;
    franchiseId: string;
    franchiseName: string;
    totalOnlineOrders: number;
    totalProcurements: number;
    totalRevenue: string;
    platformEarning: string;
    marginPercentage: number; // Phase 179 #15
  }>;
  page: number;
  limit: number;
  metric?: RankMetric; // Phase 179 #1
  nodeType?: RankNodeType; // Phase 179 #14
  revenueBasis?: { sellers: string; franchises: string }; // Phase 179 #5
  methodology?: string; // Phase 179 #12/#17/#18
}

// Phase 176 — per-seller financial bundle.
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
  linkSources: { settlementsUrl: string; commissionUrl: string; tdsUrl: string; tcsUrl: string };
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

// Phase 177 — per-franchise financial bundle.
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

// Phase 177 — franchise listing (reuses GET /admin/franchises).
export interface FranchiseListItem {
  id: string;
  franchiseCode: string;
  businessName: string;
  status: string;
}
export interface FranchiseList {
  franchises: FranchiseListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// Phase 177 — per-franchise reconciliation-discrepancy list.
export interface FranchiseReconDiscrepancies {
  total: number;
  page: number;
  limit: number;
  discrepancies: Array<{
    id: string;
    kind: string;
    status: string;
    severity: number;
    orderNumber: string | null;
    externalRef: string | null;
    difference: string;
    description: string;
    createdAt: string;
  }>;
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

export const adminAccountsService = {
  getOverview(fromDate?: string, toDate?: string): Promise<ApiResponse<PlatformOverview>> {
    return apiClient<PlatformOverview>(
      `/admin/accounts/dashboard/overview${rangeQs(fromDate, toDate)}`,
    );
  },
  getSellers(fromDate?: string, toDate?: string): Promise<ApiResponse<SellerOverview>> {
    return apiClient<SellerOverview>(
      `/admin/accounts/dashboard/sellers${rangeQs(fromDate, toDate)}`,
    );
  },
  getFranchises(fromDate?: string, toDate?: string): Promise<ApiResponse<FranchiseOverview>> {
    return apiClient<FranchiseOverview>(
      `/admin/accounts/dashboard/franchises${rangeQs(fromDate, toDate)}`,
    );
  },
  getOutstanding(asOfDate?: string): Promise<ApiResponse<OutstandingPayables>> {
    const qs = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : '';
    return apiClient<OutstandingPayables>(`/admin/accounts/dashboard/outstanding${qs}`);
  },
  // Phase 178 (#4/#11) — freeze / release a settlement from payout.
  setSettlementHold(
    nodeType: 'SELLER' | 'FRANCHISE',
    settlementId: string,
    hold: boolean,
    holdReason?: string,
  ): Promise<ApiResponse<{ id: string; status: string }>> {
    return apiClient(
      `/admin/accounts/dashboard/payables/${nodeType}/${settlementId}/hold`,
      { method: 'POST', body: JSON.stringify({ hold, holdReason }) },
    );
  },
  // Phase 178 (#12) — record a partial / full disbursement. `amount` is a
  // positive rupee string (server converts to exact paise).
  recordSettlementPayment(
    nodeType: 'SELLER' | 'FRANCHISE',
    settlementId: string,
    amount: string,
  ): Promise<ApiResponse<{ id: string; status: string; paidAmountInPaise: string }>> {
    return apiClient(
      `/admin/accounts/dashboard/payables/${nodeType}/${settlementId}/payment`,
      { method: 'POST', body: JSON.stringify({ amount }) },
    );
  },
  payablesAgingCsvUrl(asOfDate?: string): string {
    return `/admin/accounts/dashboard/payables/aging.csv${asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : ''}`;
  },
  getTopPerformers(opts: {
    limit?: number;
    page?: number;
    fromDate?: string;
    toDate?: string;
    metric?: RankMetric; // #1
    nodeType?: RankNodeType; // #14
  } = {}): Promise<ApiResponse<TopPerformers>> {
    const qs = new URLSearchParams();
    qs.set('limit', String(opts.limit ?? 10));
    qs.set('page', String(opts.page ?? 1));
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    if (opts.metric) qs.set('metric', opts.metric);
    if (opts.nodeType) qs.set('nodeType', opts.nodeType);
    return apiClient<TopPerformers>(
      `/admin/accounts/dashboard/top-performers?${qs.toString()}`,
    );
  },
  // Phase 179 (#10) — CSV export URL (download anchor; auth handled by the
  // browser session like the other accounts CSV exports).
  topPerformersCsvUrl(opts: { limit?: number; fromDate?: string; toDate?: string; metric?: RankMetric; nodeType?: RankNodeType } = {}): string {
    const qs = new URLSearchParams();
    qs.set('limit', String(opts.limit ?? 50));
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    if (opts.metric) qs.set('metric', opts.metric);
    if (opts.nodeType) qs.set('nodeType', opts.nodeType);
    return `/admin/accounts/dashboard/top-performers/export.csv?${qs.toString()}`;
  },

  // ── Phase 180 — Revenue / Margin / Payouts / Reconciliation reports ──
  getRevenueReport(opts: { fromDate: string; toDate: string; groupBy?: 'day' | 'week' | 'month' }): Promise<ApiResponse<RevenueRow[]>> {
    const qs = new URLSearchParams({ fromDate: opts.fromDate, toDate: opts.toDate, groupBy: opts.groupBy ?? 'day' });
    return apiClient<RevenueRow[]>(`/admin/accounts/reports/revenue?${qs.toString()}`);
  },
  getMarginReport(opts: { fromDate: string; toDate: string; dateBasis?: MarginDateBasis; nodeType?: ReportNodeType; nodeId?: string }): Promise<ApiResponse<MarginReport>> {
    const qs = new URLSearchParams({ fromDate: opts.fromDate, toDate: opts.toDate });
    if (opts.dateBasis) qs.set('dateBasis', opts.dateBasis);
    if (opts.nodeType) qs.set('nodeType', opts.nodeType);
    if (opts.nodeId) qs.set('nodeId', opts.nodeId);
    return apiClient<MarginReport>(`/admin/accounts/reports/margins?${qs.toString()}`);
  },
  getPayoutReport(opts: { fromDate: string; toDate: string; nodeType?: PayoutNodeType; nodeId?: string }): Promise<ApiResponse<PayoutReport>> {
    const qs = new URLSearchParams({ fromDate: opts.fromDate, toDate: opts.toDate });
    if (opts.nodeType) qs.set('nodeType', opts.nodeType);
    if (opts.nodeId) qs.set('nodeId', opts.nodeId);
    return apiClient<PayoutReport>(`/admin/accounts/reports/payouts?${qs.toString()}`);
  },
  getReconciliationReport(opts: { fromDate?: string; toDate?: string } = {}): Promise<ApiResponse<ReconciliationReport>> {
    const qs = new URLSearchParams();
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    const s = qs.toString();
    return apiClient<ReconciliationReport>(`/admin/accounts/reports/reconciliation${s ? `?${s}` : ''}`);
  },
  reportCsvUrl(type: 'revenue' | 'margins' | 'payouts', opts: Record<string, string | undefined>): string {
    const qs = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const path = type === 'payouts' ? 'payouts/export' : `${type}/export.csv`;
    return `/admin/accounts/reports/${path}?${qs.toString()}`;
  },

  // Phase 176 — per-seller drill-down.
  getSellerAccounts(
    sellerId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<ApiResponse<SellerAccountsOverview>> {
    return apiClient<SellerAccountsOverview>(
      `/admin/accounts/dashboard/sellers/${sellerId}/overview${rangeQs(fromDate, toDate)}`,
    );
  },
  getSellerCommissionRecords(
    sellerId: string,
    opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {},
  ): Promise<ApiResponse<SellerCommissionRecords>> {
    const qs = new URLSearchParams();
    qs.set('page', String(opts.page ?? 1));
    qs.set('limit', String(opts.limit ?? 50));
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    return apiClient<SellerCommissionRecords>(
      `/admin/accounts/dashboard/sellers/${sellerId}/commission-records?${qs.toString()}`,
    );
  },
  getSellerSettlements(
    sellerId: string,
    opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {},
  ): Promise<ApiResponse<SellerSettlementsList>> {
    const qs = new URLSearchParams();
    qs.set('page', String(opts.page ?? 1));
    qs.set('limit', String(opts.limit ?? 50));
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    return apiClient<SellerSettlementsList>(
      `/admin/accounts/dashboard/sellers/${sellerId}/settlements?${qs.toString()}`,
    );
  },
  sellerCsvUrl(sellerId: string, fromDate?: string, toDate?: string): string {
    return `/admin/accounts/dashboard/sellers/${sellerId}/export.csv${rangeQs(fromDate, toDate)}`;
  },

  // Phase 177 — per-franchise drill-down.
  getFranchiseAccounts(
    franchiseId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<ApiResponse<FranchiseAccountsOverview>> {
    return apiClient<FranchiseAccountsOverview>(
      `/admin/accounts/dashboard/franchises/${franchiseId}/overview${rangeQs(fromDate, toDate)}`,
    );
  },
  getFranchiseLedger(
    franchiseId: string,
    opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {},
  ): Promise<ApiResponse<FranchiseLedgerEntries>> {
    const qs = new URLSearchParams();
    qs.set('page', String(opts.page ?? 1));
    qs.set('limit', String(opts.limit ?? 50));
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    return apiClient<FranchiseLedgerEntries>(
      `/admin/accounts/dashboard/franchises/${franchiseId}/ledger?${qs.toString()}`,
    );
  },
  getFranchisePosSales(
    franchiseId: string,
    opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {},
  ): Promise<ApiResponse<FranchisePosSales>> {
    const qs = new URLSearchParams();
    qs.set('page', String(opts.page ?? 1));
    qs.set('limit', String(opts.limit ?? 50));
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    return apiClient<FranchisePosSales>(
      `/admin/accounts/dashboard/franchises/${franchiseId}/pos-sales?${qs.toString()}`,
    );
  },
  getFranchiseSettlements(
    franchiseId: string,
    opts: { page?: number; limit?: number; fromDate?: string; toDate?: string } = {},
  ): Promise<ApiResponse<FranchiseSettlementsList>> {
    const qs = new URLSearchParams();
    qs.set('page', String(opts.page ?? 1));
    qs.set('limit', String(opts.limit ?? 50));
    if (opts.fromDate) qs.set('fromDate', opts.fromDate);
    if (opts.toDate) qs.set('toDate', opts.toDate);
    return apiClient<FranchiseSettlementsList>(
      `/admin/accounts/dashboard/franchises/${franchiseId}/settlements?${qs.toString()}`,
    );
  },
  franchiseCsvUrl(franchiseId: string, fromDate?: string, toDate?: string): string {
    return `/admin/accounts/dashboard/franchises/${franchiseId}/export.csv${rangeQs(fromDate, toDate)}`;
  },

  // Phase 177 (#2) — franchise selector list (reuses the existing endpoint).
  listFranchises(
    opts: { page?: number; limit?: number; search?: string; status?: string } = {},
  ): Promise<ApiResponse<FranchiseList>> {
    const qs = new URLSearchParams();
    qs.set('page', String(opts.page ?? 1));
    qs.set('limit', String(opts.limit ?? 25));
    if (opts.search) qs.set('search', opts.search);
    if (opts.status) qs.set('status', opts.status);
    return apiClient<FranchiseList>(`/admin/franchises?${qs.toString()}`);
  },
  // Phase 177 (#10) — per-franchise reconciliation discrepancies.
  getFranchiseRecon(
    franchiseId: string,
    opts: { page?: number; status?: string } = {},
  ): Promise<ApiResponse<FranchiseReconDiscrepancies>> {
    const qs = new URLSearchParams();
    qs.set('page', String(opts.page ?? 1));
    if (opts.status) qs.set('status', opts.status);
    return apiClient<FranchiseReconDiscrepancies>(
      `/admin/accounts/dashboard/franchises/${franchiseId}/reconciliation-discrepancies?${qs.toString()}`,
    );
  },
  // Phase 177 (#4) — record an adjustment against a PENDING franchise settlement.
  createFranchiseAdjustment(
    franchiseId: string,
    settlementId: string,
    body: { amount: string; adjustmentType: string; notes?: string },
  ): Promise<ApiResponse<{ id: string }>> {
    return apiClient(
      `/admin/accounts/dashboard/franchises/${franchiseId}/settlements/${settlementId}/adjustments`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
};

/** Format a 2-decimal rupee string as ₹-prefixed Indian-grouped currency. */
export function formatINR(value: string | null | undefined): string {
  if (value == null || value === '') return '₹0.00';
  const n = Number(value);
  if (Number.isNaN(n)) return `₹${value}`;
  return (
    '₹' +
    n.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
