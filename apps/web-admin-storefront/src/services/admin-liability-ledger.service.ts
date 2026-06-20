import { apiClient, ApiResponse } from '@/lib/api-client';

export type LedgerType =
  | 'seller_debit'
  | 'logistics_claim'
  | 'platform_expense';

/**
 * Phase 13 — admin browser for the three liability-ledger tables.
 * Wire format mirrors what the Prisma schema returns. `amountInPaise`
 * is a string on the wire (BigInt) — caller converts to Number for
 * display.
 */
export interface SellerDebitRow {
  id: string;
  sellerId: string;
  sourceType: string;
  sourceId: string;
  orderId: string | null;
  subOrderId: string | null;
  amountInPaise: string;
  reason: string;
  status: string;
  settlementAdjustedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LogisticsClaimRow {
  id: string;
  sourceType: string;
  sourceId: string;
  courierName: string | null;
  awbNumber: string | null;
  claimType: string | null;
  amountInPaise: string;
  reason: string;
  status: string;
  evidenceFileId: string | null;
  notes: string | null;
  filedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformExpenseRow {
  id: string;
  sourceType: string;
  sourceId: string;
  expenseType: string;
  amountInPaise: string;
  reason: string;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LedgerRow = SellerDebitRow | LogisticsClaimRow | PlatformExpenseRow;

export interface LedgerListResponse {
  items: LedgerRow[];
  total: number;
  page: number;
  limit: number;
  type: LedgerType;
}

/**
 * Server-aggregated KPI totals (paise strings) over the WHOLE table — replaces
 * the old page-summed KPIs which under-counted past 50 rows and mishandled
 * reversed/cancelled/reclassified rows.
 */
export interface LedgerSummary {
  totalRecordedInPaise: string;
  sellerDebitsPendingInPaise: string;
  logisticsClaimsPendingInPaise: string;
  platformExpenseInPaise: string;
}

export const adminLiabilityLedgerService = {
  list(
    type: LedgerType,
    filters: { sourceType?: string; sourceId?: string; page?: number; limit?: number } = {},
  ): Promise<ApiResponse<LedgerListResponse>> {
    const qs = new URLSearchParams();
    if (filters.sourceType) qs.set('sourceType', filters.sourceType);
    if (filters.sourceId) qs.set('sourceId', filters.sourceId);
    qs.set('page', String(filters.page ?? 1));
    qs.set('limit', String(filters.limit ?? 50));
    return apiClient<LedgerListResponse>(
      `/admin/liability-ledger/${type}?${qs.toString()}`,
    );
  },

  /** Advance a logistics claim's recovery lifecycle (or REJECT it, which
   *  auto-reclassifies the cost to a platform expense). */
  transitionClaim(
    id: string,
    toStatus: 'SUBMITTED' | 'ACCEPTED' | 'RECOVERED' | 'REJECTED' | 'CANCELLED',
    note?: string,
  ): Promise<ApiResponse<LogisticsClaimRow & { reclassifiedExpenseId: string | null }>> {
    return apiClient(`/admin/liability-ledger/claims/${id}/transition`, {
      method: 'PATCH',
      body: JSON.stringify({ toStatus, note }),
    });
  },

  /** Un-book a mis-attributed platform expense (soft reversal). */
  reverseExpense(id: string, reason: string): Promise<ApiResponse<PlatformExpenseRow>> {
    return apiClient(`/admin/liability-ledger/expenses/${id}/reverse`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  /** Cancel a PENDING seller debit (already-wired API, now surfaced in UI). */
  cancelDebit(id: string, reason: string): Promise<ApiResponse<SellerDebitRow>> {
    return apiClient(`/admin/liability-ledger/debits/${id}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  /** Whole-table KPI aggregates for the headline cards (not page-limited). */
  summary(): Promise<ApiResponse<LedgerSummary>> {
    return apiClient<LedgerSummary>('/admin/liability-ledger/summary/totals');
  },
};
