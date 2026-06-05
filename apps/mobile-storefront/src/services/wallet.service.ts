import {apiClient, ApiResponse} from '../lib/api-client';

// Mirrors apps/web-storefront/src/services/wallet.service.ts. The Razorpay-
// backed topup endpoints are intentionally omitted in v5 — they need the
// native Razorpay SDK which is a Phase 6 dependency.

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

  /**
   * Start a topup: backend reserves a pending wallet transaction in
   * PENDING state and creates a Razorpay order. The caller opens the
   * Razorpay sheet with the returned razorpayOrderId, then verifies.
   */
  initiateTopup(
    amountInPaise: number,
  ): Promise<ApiResponse<TopupInitiatedResponse>> {
    return apiClient<TopupInitiatedResponse>('/customer/wallet/topup', {
      method: 'POST',
      body: JSON.stringify({amountInPaise}),
    });
  },

  /**
   * Verify the Razorpay signature after the sheet closes. Backend
   * recomputes the HMAC against its secret before flipping the wallet
   * transaction to COMPLETED and crediting the balance.
   */
  verifyTopup(
    payload: VerifyTopupPayload,
  ): Promise<ApiResponse<VerifyTopupResponse>> {
    return apiClient<VerifyTopupResponse>('/customer/wallet/topup/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

// Paise → ₹ string with thousands separator. Show fractional only when
// the value has paise component — keeps clean ₹500 rather than ₹500.00
// for the common case.
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

const CREDIT_TYPES: WalletTransactionType[] = [
  'TOPUP',
  'REFUND',
  'CREDIT_ADJUSTMENT',
];

export function transactionDirection(
  type: WalletTransactionType,
): 'credit' | 'debit' {
  return CREDIT_TYPES.includes(type) ? 'credit' : 'debit';
}

export function transactionTypeLabel(type: WalletTransactionType): string {
  switch (type) {
    case 'TOPUP':
      return 'Top-up';
    case 'REFUND':
      return 'Refund';
    case 'CREDIT_ADJUSTMENT':
      return 'Credit';
    case 'DEBIT':
      return 'Spent';
    case 'DEBIT_ADJUSTMENT':
      return 'Adjustment';
  }
}
