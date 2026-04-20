export const ACCOUNTS_REPOSITORY = Symbol('AccountsRepository');

export interface AccountsRepository {
  // ── Platform-wide KPIs ──
  getPlatformFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
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
  }>;

  // ── Seller financial overview ──
  getSellerFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
    totalSellers: number;
    activeSellers: number;
    totalCommissionRecords: number;
    totalPlatformAmount: number;
    totalSettlementAmount: number;
    totalPlatformMargin: number;
    pendingSettlementAmount: number;
    settledAmount: number;
  }>;

  // ── Franchise financial overview ──
  getFranchiseFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }): Promise<{
    totalFranchises: number;
    activeFranchises: number;
    totalLedgerEntries: number;
    totalOnlineOrderCommission: number;
    totalProcurementFees: number;
    totalFranchiseEarnings: number;
    pendingSettlementAmount: number;
    settledAmount: number;
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
      totalAmount: number;
      platformEarning: number;
      pendingAmount: number;
      settledAmount: number;
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
      totalRevenue: number;
      sellerFulfilledAmount: number;
      franchiseFulfilledAmount: number;
      platformEarning: number;
    }>
  >;

  // ── Top performers ──
  getTopSellers(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<
    Array<{
      sellerId: string;
      sellerName: string;
      totalOrders: number;
      totalRevenue: number;
      platformMargin: number;
      marginPercentage: number;
    }>
  >;

  getTopFranchises(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<
    Array<{
      franchiseId: string;
      franchiseName: string;
      totalOnlineOrders: number;
      totalProcurements: number;
      totalRevenue: number;
      platformEarning: number;
    }>
  >;

  // ── Outstanding payables ──
  getOutstandingPayables(): Promise<{
    sellerOutstanding: { count: number; amount: number };
    franchiseOutstanding: { count: number; amount: number };
    totalOutstanding: number;
    oldestUnpaidDate: Date | null;
  }>;
}
