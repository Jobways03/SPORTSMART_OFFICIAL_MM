import { apiClient, API_BASE, ApiResponse } from '@/lib/api-client';

export type WalletTransactionType =
  | 'TOPUP'
  | 'REFUND'
  | 'CREDIT_ADJUSTMENT'
  | 'DEBIT'
  | 'DEBIT_ADJUSTMENT'
  | 'LOYALTY_REBATE' // Phase 182 (#2)
  | 'MANUAL_CREDIT' // Phase 183 (#5)
  | 'MANUAL_DEBIT'
  | 'GOODWILL_CREDIT'
  | 'ORDER_REDEMPTION'
  | 'REVERSAL';

export type WalletTransactionStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVERSED';

export interface WalletBalance {
  balanceInPaise: number;
  currency: string;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  type: WalletTransactionType;
  status: WalletTransactionStatus;
  amountInPaise: number;
  balanceAfterInPaise: number;
  balanceBeforeInPaise?: number; // Phase 182 (#4)
  direction?: 'CREDIT' | 'DEBIT'; // Phase 182 (#5)
  currency?: string; // Phase 182 (#9)
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber?: string | null; // Phase 182 (#8)
  description: string;
  createdAt: string;
  // internalNotes + createdByAdminId are stripped server-side (#11) — not here.
}

export interface WalletTransactionPage {
  items: WalletTransaction[];
  page: number;
  limit: number;
  total: number;
}

export interface TopupInitiatedResponse {
  walletTransactionId: string;
  razorpayOrderId: string;
  amountInPaise: number;
  currency: string;
}

export interface VerifyTopupPayload {
  walletTransactionId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface VerifyTopupResponse {
  balanceInPaise: number;
  transaction: WalletTransaction;
}

export const walletService = {
  getWallet(): Promise<ApiResponse<WalletBalance>> {
    return apiClient<WalletBalance>('/customer/wallet');
  },

  listTransactions(
    page = 1,
    limit = 20,
  ): Promise<ApiResponse<WalletTransactionPage>> {
    return apiClient<WalletTransactionPage>(
      `/customer/wallet/transactions?page=${page}&limit=${limit}`,
    );
  },

  initiateTopup(
    amountInPaise: number,
  ): Promise<ApiResponse<TopupInitiatedResponse>> {
    return apiClient<TopupInitiatedResponse>('/customer/wallet/topup', {
      method: 'POST',
      body: JSON.stringify({ amountInPaise }),
    });
  },

  verifyTopup(
    payload: VerifyTopupPayload,
  ): Promise<ApiResponse<VerifyTopupResponse>> {
    return apiClient<VerifyTopupResponse>('/customer/wallet/topup/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Phase 182 (#10) — download the statement-of-account CSV. Token auth means a
  // plain <a download> can't carry the header, so we fetch + blob-download.
  async downloadStatementCsv(): Promise<void> {
    const token =
      typeof window !== 'undefined' ? window.localStorage.getItem('accessToken') : null;
    const res = await fetch(`${API_BASE}/customer/wallet/transactions/export.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error('Could not download statement');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallet-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

/** ₹ formatter — paise to INR string with thousands separator, no decimals
 *  for whole rupees, two decimals when paise > 0. */
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

/** Signed display for transactions: "+ ₹500" or "− ₹250". */
export function formatTransactionAmount(tx: WalletTransaction): string {
  const abs = Math.abs(tx.amountInPaise);
  const sign = tx.amountInPaise >= 0 ? '+' : '−';
  return `${sign} ${formatPaise(abs)}`;
}
