export const ACCOUNTS_REPOSITORY = Symbol('AccountsRepository');

// Phase 179 (Top Performers audit #1) — leaderboard ranking metric.
export type RankMetric = 'REVENUE' | 'MARGIN';
export type RankNodeType = 'SELLER' | 'FRANCHISE' | 'ALL';

// Phase 175 (Accounts Overview audit #3) — money fields are EXACT 2-decimal
// rupee strings (never JS Number) across every dashboard read. `currency` is
// stamped on each payload (#20).

export interface AccountsRepository {
  // ── Platform-wide KPIs ──
  getPlatformFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
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
  }>;

  // ── Seller financial overview ──
  getSellerFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
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
  }>;

  // ── Franchise financial overview ──
  getFranchiseFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
    currency: string;
    totalFranchises: number;
    activeFranchises: number;
    totalLedgerEntries: number;
    totalOnlineOrderCommission: string;
    totalProcurementFees: string;
    totalFranchiseEarnings: string;
    pendingSettlementAmount: string;
    settledAmount: string;
  }>;

  // ── Unified payables list (sellers + franchises combined) ──
  getPayablesSummary(params: {
    page: number;
    limit: number;
    nodeType?: 'SELLER' | 'FRANCHISE' | 'ALL';
    status?: 'PENDING' | 'APPROVED' | 'PAID';
    search?: string;
  }): Promise<{
    payables: Array<{
      nodeType: 'SELLER' | 'FRANCHISE';
      nodeId: string;
      nodeName: string;
      totalOrders: number;
      totalAmount: string;
      platformEarning: string;
      pendingAmount: string;
      settledAmount: string;
      lastPaidAt: Date | null;
    }>;
    total: number;
  }>;

  // ── Settlement cycles (unified view) ──
  getSettlementCycles(params: {
    page: number;
    limit: number;
    status?: string;
  }): Promise<{
    cycles: Array<{
      id: string;
      periodStart: Date;
      periodEnd: Date;
      status: string;
      sellerSettlementCount: number;
      franchiseSettlementCount: number;
      totalSellerPayable: number;
      totalFranchisePayable: number;
      totalPlatformEarning: number;
      createdAt: Date;
    }>;
    total: number;
  }>;

  // ── Revenue breakdown ──
  getRevenueBreakdown(params: {
    fromDate: Date;
    toDate: Date;
    groupBy: 'day' | 'week' | 'month';
  }): Promise<
    Array<{
      period: string;
      // Phase 180 — exact 2-decimal rupee STRINGS (#10), realized + net of
      // refunds (#3/#11), commission-derived margin (#4).
      totalRevenue: string;
      refunds: string;
      netRevenue: string;
      sellerFulfilledAmount: string;
      franchiseFulfilledAmount: string;
      platformCommissionMargin: string;
    }>
  >;

  // ── Top performers (Phase 179 — metric-selectable, reconciles with #177) ──
  getTopSellers(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
    offset?: number,
    metric?: RankMetric,
  ): Promise<
    Array<{
      rank: number;
      sellerId: string;
      sellerName: string;
      totalOrders: number;
      totalRevenue: string;
      platformMargin: string;
      marginPercentage: number;
    }>
  >;

  getTopFranchises(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
    offset?: number,
    metric?: RankMetric,
  ): Promise<
    Array<{
      rank: number;
      franchiseId: string;
      franchiseName: string;
      totalOnlineOrders: number;
      totalProcurements: number;
      totalRevenue: string;
      platformEarning: string;
      marginPercentage: number;
    }>
  >;

  // ── Outstanding payables (Phase 178 — aging + net) ──
  getOutstandingPayables(asOfDate?: Date): Promise<{
    currency: string;
    sellerOutstanding: { count: number; amount: string };
    franchiseOutstanding: { count: number; amount: string };
    totalOutstanding: string;
    oldestUnpaidDate: Date | null;
    aging: {
      buckets: Array<{ bucket: string; severity: string | null; count: number; amount: string }>;
      overdue: { count: number; amount: string };
    };
    frozen: { count: number };
    failed: { count: number };
  }>;

  // Phase 178 (#4/#11) — freeze / unfreeze a settlement (excludes it from
  // overdue aging until released).
  setSettlementHold(args: {
    nodeType: 'SELLER' | 'FRANCHISE';
    settlementId: string;
    hold: boolean;
    holdReason?: string | null;
    adminId?: string;
  }): Promise<{ id: string; status: string; frozenAt: Date | null }>;

  // Phase 178 (#12) — record a partial / full bank disbursement.
  recordSettlementPayment(args: {
    nodeType: 'SELLER' | 'FRANCHISE';
    settlementId: string;
    amountInPaise: bigint;
    adminId?: string;
  }): Promise<{ id: string; status: string; paidAmountInPaise: string }>;

  // ── Phase 176: per-seller drill-down ──
  getSellerAccountsOverview(
    sellerId: string,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<SellerAccountsOverview | null>;

  getSellerCommissionRecords(
    sellerId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ): Promise<{
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
  }>;

  getSellerSettlements(
    sellerId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ): Promise<{
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
  }>;

  // ── Phase 177: per-franchise drill-down ──
  getFranchiseAccountsOverview(
    franchiseId: string,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<FranchiseAccountsOverview | null>;

  getFranchiseLedgerEntries(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
    sourceType?: string,
    status?: string,
  ): Promise<{
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
  }>;

  getFranchiseReconciliationDiscrepancies(
    franchiseId: string,
    status: string | undefined,
    page: number,
    limit: number,
  ): Promise<{
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
  }>;

  createFranchiseSettlementAdjustment(args: {
    settlementId: string;
    amount: string;
    adjustmentType: import('@prisma/client').SettlementAdjustmentType;
    notes?: string | null;
    adminId?: string;
  }): Promise<{ id: string }>;

  getFranchisePosSales(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ): Promise<{
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
  }>;

  getFranchiseSettlementsList(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ): Promise<{
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
  }>;
}

// Phase 176 — the per-seller financial bundle.
export interface SellerAccountsOverview {
  currency: string;
  seller: { id: string; name: string; gstin: string | null; pan: string | null; status: string };
  period: { from: string | null; to: string | null };
  revenue: { gross: string; refundsDeducted: string; net: string; taxExcluded: string };
  margin: { platformMargin: string; marginPercentage: number };
  commission: { recordCount: number; statusBreakdown: Record<string, number>; totalSettlementAmount: string };
  payable: {
    pendingCount: number;
    pendingAmount: string;
    paidCount: number;
    paidAmount: string;
    lastSettledOn: string | null;
  };
  overdue: { count: number; amount: string }; // Phase 178 #18
  taxDeductions: {
    tdsDeducted: string;
    tdsRowCount: number;
    tdsDepositedCount: number;
    tcsCollected: string;
    tcsRowCount: number;
    note: string;
  };
  adjustments: { count: number; totalAmount: string };
  reversals: { count: number; refundedAdminEarning: string };
  reconciliation: { openDiscrepancies: number; resolvedDiscrepancies: number };
  linkSources: { settlementsUrl: string; commissionUrl: string; tdsUrl: string; tcsUrl: string };
}

// Phase 177 — the per-franchise financial bundle.
export interface FranchiseAccountsOverview {
  currency: string;
  franchise: { id: string; code: string; name: string; gstin: string | null; pan: string | null; status: string; warehousePincode: string | null };
  period: { from: string | null; to: string | null };
  revenue: { onlineRevenue: string; posGross: string; posReturns: string; posNet: string; totalRevenue: string };
  procurement: { totalProcuredValue: string; procurementFees: string; procurementCount: number; note: string };
  platformMargin: { online: string; procurement: string; total: string };
  pos: { saleCount: number; voidedCount: number; returnCount: number };
  payable: { pendingCount: number; pendingAmount: string; paidCount: number; paidAmount: string; lastSettledOn: string | null };
  overdue: { count: number; amount: string }; // Phase 178 #18
  reversals: { count: number; baseAmount: string; platformEarning: string };
  adjustments: { count: number; totalAmount: string };
  reconciliation: { openDiscrepancies: number; resolvedDiscrepancies: number };
  linkSources: { ledgerCsvUrl: string; settlementsUrl: string };
}
