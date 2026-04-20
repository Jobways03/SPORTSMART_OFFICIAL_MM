import { apiClient, ApiResponse } from '@/lib/api-client';

export type LedgerSourceType =
  | 'ONLINE_ORDER'
  | 'PROCUREMENT_FEE'
  | 'RETURN_REVERSAL'
  | 'ADJUSTMENT'
  | 'PENALTY';

export type LedgerStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'SETTLED'
  | 'REVERSED';

export type SettlementStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'FAILED';

export interface EarningsSummary {
  totalEarnings: number;
  pendingSettlement: number;
  totalPlatformFees: number;
  totalOnlineCommission: number;
  totalProcurementFees: number;
}

export interface LedgerEntry {
  id: string;
  franchiseId: string;
  sourceType: LedgerSourceType | string;
  sourceId: string;
  description: string | null;
  baseAmount: number | string;
  rate: number | string;
  computedAmount: number | string;
  platformEarning: number | string;
  franchiseEarning: number | string;
  status: LedgerStatus | string;
  settlementBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerHistoryResponse {
  entries: LedgerEntry[];
  total: number;
}

export interface FranchiseSettlement {
  id: string;
  cycleId: string;
  franchiseId: string;
  franchiseName: string;
  totalOnlineOrders: number;
  totalOnlineAmount: number | string;
  totalOnlineCommission: number | string;
  totalProcurements: number;
  totalProcurementAmount: number | string;
  totalProcurementFees: number | string;
  totalPosSales: number;
  totalPosAmount: number | string;
  totalPosFees: number | string;
  reversalAmount: number | string;
  adjustmentAmount: number | string;
  grossFranchiseEarning: number | string;
  totalPlatformEarning: number | string;
  netPayableToFranchise: number | string;
  status: SettlementStatus | string;
  paidAt: string | null;
  paymentReference: string | null;
  createdAt: string;
  updatedAt: string;
  cycle?: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: string;
  };
  franchise?: {
    id: string;
    franchiseCode: string;
    businessName: string;
    ownerName: string;
  };
  ledgerEntries?: LedgerEntry[];
}

export interface SettlementsListResponse {
  settlements: FranchiseSettlement[];
  total: number;
}

export const franchiseEarningsService = {
  getSummary(): Promise<ApiResponse<EarningsSummary>> {
    return apiClient<EarningsSummary>('/franchise/earnings');
  },

  getLedgerHistory(
    params: {
      page?: number;
      limit?: number;
      sourceType?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
    } = {},
  ): Promise<ApiResponse<LedgerHistoryResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.sourceType) qs.set('sourceType', params.sourceType);
    if (params.status) qs.set('status', params.status);
    if (params.fromDate) qs.set('fromDate', params.fromDate);
    if (params.toDate) qs.set('toDate', params.toDate);
    return apiClient<LedgerHistoryResponse>(
      `/franchise/earnings/history?${qs.toString()}`,
    );
  },

  listSettlements(
    params: { page?: number; limit?: number; status?: string } = {},
  ): Promise<ApiResponse<SettlementsListResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    return apiClient<SettlementsListResponse>(
      `/franchise/earnings/settlements?${qs.toString()}`,
    );
  },

  getSettlement(id: string): Promise<ApiResponse<FranchiseSettlement>> {
    return apiClient<FranchiseSettlement>(
      `/franchise/earnings/settlements/${id}`,
    );
  },
};
