import { apiClient, ApiResponse } from '@/lib/api-client';
import { paiseToRupeesString, type PaiseValue } from '@sportsmart/shared-utils';

export type WalletTransactionType =
  | 'TOPUP'
  | 'REFUND'
  | 'CREDIT_ADJUSTMENT'
  | 'DEBIT'
  | 'DEBIT_ADJUSTMENT';

export type WalletTransactionStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVERSED';

export interface AdminWalletListItem {
  walletId: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  // Paise from the API arrives as `number` for values that fit in
  // JS-safe-integer (anything up to ₹9 crore), or as `string` (BigInt
  // serialised) for larger values. Frontend formatters MUST go through
  // paiseToRupeesString (shared-utils) which handles both safely.
  balanceInPaise: number | string;
  currency: string;
  updatedAt: string;
  isBlocked?: boolean;
  blockedReason?: string | null;
}

export interface AdminWalletListResponse {
  items: AdminWalletListItem[];
  page: number;
  limit: number;
  total: number;
}

export interface AdminWalletTransaction {
  id: string;
  walletId: string;
  userId: string;
  type: WalletTransactionType;
  status: WalletTransactionStatus;
  // Signed paise (negative = debit). number | string per the BigInt
  // boundary note on AdminWalletListItem.
  amountInPaise: number | string;
  balanceAfterInPaise: number | string;
  referenceType: string | null;
  referenceId: string | null;
  description: string;
  internalNotes: string | null;
  createdByAdminId: string | null;
  createdAt: string;
}

export interface AdminWalletDetail {
  wallet: {
    id: string;
    userId: string;
    balanceInPaise: number;
    currency: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    isBlocked?: boolean;
    blockedReason?: string | null;
    blockedAt?: string | null;
    blockedByAdminId?: string | null;
  };
  transactions: AdminWalletTransaction[];
}

export interface AdminMutateResult {
  balanceInPaise: number;
  transaction: AdminWalletTransaction;
}

export interface AdminWalletFilters {
  page?: number;
  limit?: number;
  search?: string;
  /** Min balance in rupees (UI value — converted to paise on the wire). */
  minBalance?: number;
  maxBalance?: number;
  blocked?: boolean;
}

export const adminWalletService = {
  list(filters: AdminWalletFilters = {}): Promise<ApiResponse<AdminWalletListResponse>> {
    const qs = new URLSearchParams();
    qs.set('page', String(filters.page ?? 1));
    qs.set('limit', String(filters.limit ?? 20));
    if (filters.search?.trim()) qs.set('search', filters.search.trim());
    if (filters.minBalance != null) qs.set('minBalance', String(filters.minBalance));
    if (filters.maxBalance != null) qs.set('maxBalance', String(filters.maxBalance));
    if (filters.blocked !== undefined) qs.set('blocked', String(filters.blocked));
    return apiClient<AdminWalletListResponse>(`/admin/wallets?${qs.toString()}`);
  },

  getDetail(userId: string): Promise<ApiResponse<AdminWalletDetail>> {
    return apiClient<AdminWalletDetail>(`/admin/wallets/${userId}`);
  },

  credit(
    userId: string,
    // Phase 183 — reason (audit-grade, required) + optional referenceNumber.
    payload: { amountInPaise: number; reason: string; description: string; internalNotes?: string; referenceNumber?: string },
  ): Promise<ApiResponse<AdminMutateResult>> {
    return apiClient<AdminMutateResult>(`/admin/wallets/${userId}/credit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  debit(
    userId: string,
    payload: { amountInPaise: number; reason: string; description: string; internalNotes?: string; referenceNumber?: string },
  ): Promise<ApiResponse<AdminMutateResult>> {
    return apiClient<AdminMutateResult>(`/admin/wallets/${userId}/debit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  block(userId: string, reason?: string): Promise<ApiResponse<AdminWalletDetail['wallet']>> {
    return apiClient(`/admin/wallets/${userId}/block`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  unblock(userId: string): Promise<ApiResponse<AdminWalletDetail['wallet']>> {
    return apiClient(`/admin/wallets/${userId}/unblock`, { method: 'PATCH' });
  },
};

/**
 * Delegate to the shared BigInt-safe formatter. Keeps backwards-
 * compatible signature for the dozen-ish call sites in this app.
 */
export function formatPaise(paise: PaiseValue): string {
  return paiseToRupeesString(paise);
}

export function signedAmount(tx: AdminWalletTransaction): string {
  const v = tx.amountInPaise;
  // Coerce to BigInt for the sign check + abs without losing precision.
  const bi = typeof v === 'bigint' ? v : BigInt(v);
  const negative = bi < BigInt(0); // BigInt(0) — the literal 0n needs ES2020 target
  const abs = negative ? -bi : bi;
  const sign = negative ? '−' : '+';
  return `${sign} ${paiseToRupeesString(abs)}`;
}
