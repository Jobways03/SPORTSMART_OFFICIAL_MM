export interface NormalizedPaymentCaptureResult {
  providerPaymentId: string;
  orderId: string;
  // Phase 0 (PR 0.5) — paise as BigInt. Razorpay's API speaks paise
  // natively, so the adapter no longer round-trips through rupees-as-
  // JS-number (the original silent-precision-loss path).
  amountInPaise: bigint;
  currency: string;
  status: 'captured' | 'failed';
  capturedAt: Date;
}

export interface NormalizedRefundResult {
  providerRefundId: string;
  paymentId: string;
  amountInPaise: bigint;
  status: 'processed' | 'failed';
  processedAt: Date;
}

export interface NormalizedWebhookEvent {
  eventType: string;
  paymentId: string;
  orderId: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
}
