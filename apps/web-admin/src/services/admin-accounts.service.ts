import { apiClient, ApiResponse } from '@/lib/api-client';

export interface PlatformOverview {
  totalPlatformRevenue: number;
  totalSellerPayables: number;
  totalFranchisePayables: number;
  totalPlatformEarnings: number;
  totalSellerCommission: number;
  totalFranchiseCommission: number;
  totalProcurementFees: number;
  pendingSellerSettlements: number;
  pendingFranchiseSettlements: number;
  totalSettledToSellers: number;
  totalSettledToFranchises: number;
}

export interface SellerOverview {
  totalSellers: number;
  activeSellers: number;
  totalCommissionRecords: number;
  totalPlatformAmount: number;
  totalSettlementAmount: number;
  totalPlatformMargin: number;
  pendingSettlementAmount: number;
  settledAmount: number;
}

export interface FranchiseOverview {
  totalFranchises: number;
  activeFranchises: number;
  totalLedgerEntries: number;
  totalOnlineOrderCommission: number;
  totalProcurementFees: number;
  totalFranchiseEarnings: number;
  pendingSettlementAmount: number;
  settledAmount: number;
}

export interface OutstandingPayables {
  sellerOutstanding: { count: number; amount: number };
  franchiseOutstanding: { count: number; amount: number };
  totalOutstanding: number;
  oldestUnpaidDate: string | null;
}

export interface TopSeller {
  sellerId: string;
  sellerName: string;
  totalOrders: number;
  totalRevenue: number;
  platformMargin: number;
  marginPercentage: number;
}

export interface TopFranchise {
  franchiseId: string;
  franchiseName: string;
  totalOnlineOrders: number;
  totalProcurements: number;
  totalRevenue: number;
  platformEarning: number;
}

export interface TopPerformersResponse {
  topSellers: TopSeller[];
  topFranchises: TopFranchise[];
}

export interface PayableEntry {
  nodeType: 'SELLER' | 'FRANCHISE';
  nodeId: string;
  nodeName: string;
  totalOrders: number;
  totalAmount: number;
  platformEarning: number;
  pendingAmount: number;
  settledAmount: number;
  lastPaidAt: string | null;
}

export interface PayablesListResponse {
  payables: PayableEntry[];
  total: number;
}

export interface SettlementCycleListItem {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  sellerSettlementCount: number;
  franchiseSettlementCount: number;
  totalSellerPayable: number;
  totalFranchisePayable: number;
  totalPlatformEarning: number;
  createdAt: string;
}

export interface SettlementCyclesListResponse {
  cycles: SettlementCycleListItem[];
  total: number;
}

export interface SettlementCycleSettlementEntry {
  id: string;
  nodeId: string;
  nodeName: string;
  totalAmount: number;
  platformEarning: number;
  payableAmount: number;
  status: string;
  settledAt: string | null;
  createdAt: string;
}

export interface SettlementCycleDetail {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalSellerPayable: number;
  totalFranchisePayable: number;
  totalPlatformEarning: number;
  sellerSettlementCount: number;
  franchiseSettlementCount: number;
  createdAt: string;
  sellerSettlements: SettlementCycleSettlementEntry[];
  franchiseSettlements: SettlementCycleSettlementEntry[];
  // Phase B (P0.5) — seller-funded discount deductions per seller.
  // Keyed by sellerId. Amounts are paise (BigInt → string on the
  // wire). Empty for cycles with no seller-funded discounts.
  discountDeductionsBySeller?: Record<string, {
    totalAmountInPaise: string;
    entries: Array<{
      masterOrderId: string;
      subOrderId: string | null;
      orderItemId: string | null;
      discountId: string;
      discountCode: string | null;
      fundingType: string;
      amountInPaise: string;
      status: string;
      reason: string | null;
      createdAt: string;
    }>;
  }>;
}

export interface RevenueBreakdownEntry {
  period: string;
  totalRevenue: number;
  sellerFulfilledAmount: number;
  franchiseFulfilledAmount: number;
  platformEarning: number;
}

export interface MarginReportEntry {
  category: string;
  totalRevenue: number;
  platformEarning: number;
  marginPercentage: number;
}

export interface MarginReportResponse {
  fromDate: string;
  toDate: string;
  overall: {
    totalRevenue: number;
    platformEarning: number;
    marginPercentage: number;
  };
  breakdown: MarginReportEntry[];
}

export interface PayoutHistoryEntry {
  id: string;
  nodeType: 'SELLER' | 'FRANCHISE';
  nodeId: string;
  nodeName: string;
  amount: number;
  paidAt: string;
  referenceId: string | null;
  status: string;
}

export interface PayoutsReportResponse {
  fromDate: string;
  toDate: string;
  totalPaid: number;
  count: number;
  payouts: PayoutHistoryEntry[];
}

export interface ReconciliationMismatch {
  type: string;
  nodeType: 'SELLER' | 'FRANCHISE';
  nodeId: string;
  nodeName: string;
  expected: number;
  actual: number;
  difference: number;
  description: string;
}

export interface ReconciliationReport {
  runAt: string;
  totalExpected: number;
  totalActual: number;
  totalDifference: number;
  mismatchCount: number;
  mismatches: ReconciliationMismatch[];
}

export const adminAccountsService = {
  getOverview(): Promise<ApiResponse<PlatformOverview>> {
    return apiClient<PlatformOverview>('/admin/accounts/dashboard/overview');
  },

  getSellerOverview(): Promise<ApiResponse<SellerOverview>> {
    return apiClient<SellerOverview>('/admin/accounts/dashboard/sellers');
  },

  getFranchiseOverview(): Promise<ApiResponse<FranchiseOverview>> {
    return apiClient<FranchiseOverview>('/admin/accounts/dashboard/franchises');
  },

  getOutstanding(): Promise<ApiResponse<OutstandingPayables>> {
    return apiClient<OutstandingPayables>('/admin/accounts/dashboard/outstanding');
  },

  getTopPerformers(): Promise<ApiResponse<TopPerformersResponse>> {
    return apiClient<TopPerformersResponse>('/admin/accounts/dashboard/top-performers');
  },

  listPayables(params: {
    page?: number;
    limit?: number;
    nodeType?: 'SELLER' | 'FRANCHISE' | 'ALL';
    status?: string;
    search?: string;
  }): Promise<ApiResponse<PayablesListResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.nodeType) qs.set('nodeType', params.nodeType);
    if (params.status) qs.set('status', params.status);
    if (params.search) qs.set('search', params.search);
    const queryString = qs.toString();
    return apiClient<PayablesListResponse>(
      `/admin/accounts/settlements/payables${queryString ? `?${queryString}` : ''}`,
    );
  },

  listCycles(params: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<ApiResponse<SettlementCyclesListResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    const queryString = qs.toString();
    return apiClient<SettlementCyclesListResponse>(
      `/admin/accounts/settlements/cycles${queryString ? `?${queryString}` : ''}`,
    );
  },

  getCycleDetail(cycleId: string): Promise<ApiResponse<SettlementCycleDetail>> {
    return apiClient<SettlementCycleDetail>(`/admin/accounts/settlements/cycles/${cycleId}`);
  },

  createCycle(periodStart: string, periodEnd: string): Promise<ApiResponse<SettlementCycleListItem>> {
    return apiClient<SettlementCycleListItem>('/admin/accounts/settlements/cycles', {
      method: 'POST',
      body: JSON.stringify({ periodStart, periodEnd }),
    });
  },

  /**
   * GET /admin/accounts/settlements/preview — dry-run a new cycle without
   * persisting it. Returns the same shape as a real cycle so the UI can
   * show what the bookkeeper is about to commit.
   */
  previewCycle(periodStart: string, periodEnd: string): Promise<ApiResponse<unknown>> {
    const qs = new URLSearchParams({ periodStart, periodEnd }).toString();
    return apiClient(`/admin/accounts/settlements/preview?${qs}`);
  },

  /** PATCH /admin/accounts/settlements/cycles/:id/preview — flip status PENDING → PREVIEWED. */
  markCyclePreviewed(cycleId: string): Promise<ApiResponse<SettlementCycleListItem>> {
    return apiClient<SettlementCycleListItem>(
      `/admin/accounts/settlements/cycles/${cycleId}/preview`,
      { method: 'PATCH' },
    );
  },

  /**
   * POST /admin/accounts/settlements/mark-paid — batch mark-paid for a set
   * of settlements across both seller and franchise ledgers.
   */
  batchMarkPaid(
    settlements: Array<{
      id: string;
      type: 'seller' | 'franchise';
      reference: string;
    }>,
  ): Promise<ApiResponse<unknown>> {
    return apiClient('/admin/accounts/settlements/mark-paid', {
      method: 'POST',
      body: JSON.stringify({ settlements }),
    });
  },

  /**
   * GET /admin/accounts/settlements/franchise-ledger/:entryId/history —
   * full audit trail for a single franchise ledger entry.
   */
  getFranchiseLedgerHistory(entryId: string): Promise<ApiResponse<unknown[]>> {
    return apiClient(
      `/admin/accounts/settlements/franchise-ledger/${entryId}/history`,
    );
  },

  /**
   * GET /admin/accounts/settlements/franchise-ledger/export — CSV export URL
   * the UI can hand to <a download>. Apply filters via query string.
   */
  franchiseLedgerExportUrl(params: { fromDate?: string; toDate?: string; franchiseId?: string } = {}): string {
    const qs = new URLSearchParams();
    if (params.fromDate) qs.set('fromDate', params.fromDate);
    if (params.toDate) qs.set('toDate', params.toDate);
    if (params.franchiseId) qs.set('franchiseId', params.franchiseId);
    const tail = qs.toString();
    return `/admin/accounts/settlements/franchise-ledger/export${tail ? `?${tail}` : ''}`;
  },

  getRevenueReport(
    fromDate: string,
    toDate: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ): Promise<ApiResponse<RevenueBreakdownEntry[]>> {
    return apiClient<RevenueBreakdownEntry[]>(
      `/admin/accounts/reports/revenue?fromDate=${fromDate}&toDate=${toDate}&groupBy=${groupBy}`,
    );
  },

  getMarginsReport(fromDate: string, toDate: string): Promise<ApiResponse<MarginReportResponse>> {
    return apiClient<MarginReportResponse>(
      `/admin/accounts/reports/margins?fromDate=${fromDate}&toDate=${toDate}`,
    );
  },

  getPayoutsReport(fromDate: string, toDate: string): Promise<ApiResponse<PayoutsReportResponse>> {
    return apiClient<PayoutsReportResponse>(
      `/admin/accounts/reports/payouts?fromDate=${fromDate}&toDate=${toDate}`,
    );
  },

  getReconciliation(): Promise<ApiResponse<ReconciliationReport>> {
    return apiClient<ReconciliationReport>('/admin/accounts/reports/reconciliation');
  },
};
