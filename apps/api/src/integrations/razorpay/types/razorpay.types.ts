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

// Phase 96 (2026-05-23) — Phase 98 audit Gap #1/#22 closure.
//
// Pre-Phase-96 the union was `'processed' | 'failed'` and the adapter
// coerced everything not-processed (including the normal `pending`
// initial state) to `'failed'`. The gateway service then treated the
// false `'failed'` as success — a critical accounting drift.
//
// Razorpay's documented refund statuses are: pending, processed,
// failed. We propagate the real string so callers can branch
// correctly + the webhook handler can reconcile asynchronously
// confirmed refunds.
export interface NormalizedRefundResult {
  providerRefundId: string;
  paymentId: string;
  amountInPaise: bigint;
  status: 'processed' | 'pending' | 'failed';
  processedAt: Date;
}

export interface NormalizedWebhookEvent {
  eventType: string;
  paymentId: string;
  orderId: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
}
