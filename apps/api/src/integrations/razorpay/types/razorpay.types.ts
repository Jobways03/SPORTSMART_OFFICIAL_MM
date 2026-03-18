export interface NormalizedPaymentCaptureResult {
  providerPaymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'captured' | 'failed';
  capturedAt: Date;
}

export interface NormalizedRefundResult {
  providerRefundId: string;
  paymentId: string;
  amount: number;
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
