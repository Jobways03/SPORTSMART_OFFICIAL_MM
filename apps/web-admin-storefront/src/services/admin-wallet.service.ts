import { apiClient, ApiResponse } from '@/lib/api-client';

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
  balanceInPaise: number;
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
  amountInPaise: number;
  balanceAfterInPaise: number;
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
    payload: { amountInPaise: number; description: string; internalNotes?: string },
  ): Promise<ApiResponse<AdminMutateResult>> {
    return apiClient<AdminMutateResult>(`/admin/wallets/${userId}/credit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  debit(
    userId: string,
    payload: { amountInPaise: number; description: string; internalNotes?: string },
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

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  const hasFractional = paise % 100 !== 0;
  return (
    '₹' +
    rupees.toLocaleString('en-IN', {
      minimumFractionDigits: hasFractional ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

export function signedAmount(tx: AdminWalletTransaction): string {
  const abs = Math.abs(tx.amountInPaise);
  const sign = tx.amountInPaise >= 0 ? '+' : '−';
  return `${sign} ${formatPaise(abs)}`;
}
