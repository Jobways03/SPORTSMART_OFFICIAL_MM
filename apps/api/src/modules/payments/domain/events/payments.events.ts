export const PAYMENTS_EVENTS = {
  INTENT_CREATED: 'payments.intent.created',
  CAPTURED: 'payments.captured',
  FAILED: 'payments.failed',
  REFUND_REQUESTED: 'payments.refund.requested',
  REFUND_COMPLETED: 'payments.refund.completed',
  REFUND_FAILED: 'payments.refund.failed',
  WEBHOOK_RECEIVED: 'payments.webhook.received',
  MISMATCH_DETECTED: 'payments.mismatch.detected',
} as const;
