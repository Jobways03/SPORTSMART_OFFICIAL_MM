export const FRANCHISE_FINANCE_REPOSITORY = Symbol('FranchiseFinanceRepository');

export interface FranchiseFinanceRepository {
  // ── Ledger CRUD ─────────────────────────────────────────────

  createLedgerEntry(data: {
    franchiseId: string;
    sourceType: string;
    sourceId: string;
    description?: string;
    baseAmount: number;
    rate: number;
    computedAmount: number;
    platformEarning: number;
    franchiseEarning: number;
  }): Promise<any>;

  findLedgerEntries(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      sourceType?: string;
      status?: string;
      fromDate?: Date;
      toDate?: Date;
    },
  ): Promise<{ entries: any[]; total: number }>;

  findPendingLedgerEntries(params: {
    fromDate: Date;
    toDate: Date;
    franchiseId?: string;
  }): Promise<any[]>;

  findLedgerEntryById(id: string): Promise<any | null>;

  findLedgerEntryBySource(
    sourceType: string,
    sourceId: string,
  ): Promise<any | null>;

  updateLedgerEntryStatus(
    id: string,
    status: string,
    settlementBatchId?: string,
  ): Promise<any>;

  bulkUpdateLedgerStatus(
    ids: string[],
    status: string,
    settlementBatchId: string,
  ): Promise<void>;

  // ── Settlement CRUD ─────────────────────────────────────────

  createSettlement(data: {
    cycleId: string;
    franchiseId: string;
    franchiseName: string;
    totalOnlineOrders: number;
    totalOnlineAmount: number;
    totalOnlineCommission: number;
    totalProcurements: number;
    totalProcurementAmount: number;
    totalProcurementFees: number;
    totalPosSales: number;
    totalPosAmount: number;
    totalPosFees: number;
    reversalAmount: number;
    adjustmentAmount: number;
    grossFranchiseEarning: number;
    totalPlatformEarning: number;
    netPayableToFranchise: number;
  }): Promise<any>;

  findSettlements(
    franchiseId: string,
    params: { page: number; limit: number; status?: string },
  ): Promise<{ settlements: any[]; total: number }>;

  findSettlementById(id: string): Promise<any | null>;

  findSettlementsByFranchiseId(franchiseId: string): Promise<any[]>;

  findAllSettlementsByCycle(cycleId: string): Promise<any[]>;

  findAllSettlementsPaginated(params: {
    page: number;
    limit: number;
    cycleId?: string;
    franchiseId?: string;
    status?: string;
  }): Promise<{ settlements: any[]; total: number }>;

  updateSettlement(id: string, data: Record<string, unknown>): Promise<any>;

  // ── Aggregation for dashboard ───────────────────────────────

  getEarningsSummary(franchiseId: string): Promise<{
    totalEarnings: number;
    pendingSettlement: number;
    totalPlatformFees: number;
    totalOnlineCommission: number;
    totalProcurementFees: number;
  }>;
}
