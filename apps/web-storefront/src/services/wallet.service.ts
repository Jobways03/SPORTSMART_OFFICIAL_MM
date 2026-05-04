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

export interface WalletBalance {
  balanceInPaise: number;
  currency: string;
}

export interface WalletTransaction {
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
