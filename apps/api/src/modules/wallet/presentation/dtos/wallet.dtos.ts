// Body shapes — kept as plain TypeScript interfaces matching the rest of
// the codebase. Validation happens at the controller boundary.

export interface InitiateTopupDto {
  amountInPaise: number;
}

export interface VerifyTopupDto {
  walletTransactionId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface AdminCreditDto {
  amountInPaise: number;
  description: string;
  internalNotes?: string;
}

export interface AdminDebitDto {
  amountInPaise: number;
  description: string;
  internalNotes?: string;
}
