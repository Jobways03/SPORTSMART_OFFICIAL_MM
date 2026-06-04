// Phase 169 (Payment Ops audit #14) — backend-owned display labels so adding a
// PaymentMismatchKind / ChargebackStatus doesn't require a coordinated UI edit
// (the UI fetches /admin/payment-ops/kind-labels and falls back to the raw key).
export const KIND_LABELS = {
  mismatchKind: {
    AMOUNT_MISMATCH: 'Amount mismatch',
    CURRENCY_MISMATCH: 'Currency mismatch',
    DUPLICATE_PAYMENT: 'Duplicate payment',
    ORPHAN_PAYMENT: 'Orphan payment',
    SIGNATURE_INVALID: 'Invalid signature',
  } as Record<string, string>,
  chargebackStatus: {
    OPEN: 'Open',
    UNDER_REVIEW: 'Under review',
    WON: 'Won',
    LOST: 'Lost',
    CLOSED: 'Closed',
  } as Record<string, string>,
  attemptKind: {
    CREATE_ORDER: 'Create order',
    CAPTURE: 'Capture',
    VERIFY_SIGNATURE: 'Verify signature',
    REFUND: 'Refund',
    POLL_STATUS: 'Poll status',
  } as Record<string, string>,
} as const;
