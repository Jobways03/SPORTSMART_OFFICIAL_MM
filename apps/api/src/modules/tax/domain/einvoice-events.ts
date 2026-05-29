// Phase 90 (2026-05-23) — Shipment Evidence audit Gap #21.
//
// Stable event names emitted by EInvoiceService. Pre-Phase-90 the
// service mutated rows silently — notifications + fraud + analytics
// subscribers had nothing to react to. These constants give downstream
// consumers a versioned contract.

export const EINVOICE_EVENTS = {
  CLASSIFIED: 'tax.einvoice.classified',
  GENERATED: 'tax.einvoice.generated',
  CANCELLED: 'tax.einvoice.cancelled',
  FAILED: 'tax.einvoice.failed',
  RETRY_EXHAUSTED: 'tax.einvoice.retry_exhausted',
  RETRY_RESET: 'tax.einvoice.retry_reset',
} as const;

// Phase 90 — Gap #19. NIC cancellation reason codes per CBIC notif.
//   1 = Duplicate
//   2 = Data entry mistake
//   3 = Order cancelled
//   4 = Other
// Any other value the admin sends server-side gets rejected with a
// 400 BAD_REQUEST so a malformed client request can't reach NIC.
export const NIC_CANCELLATION_CODES = [1, 2, 3, 4] as const;
export type NicCancellationCode = (typeof NIC_CANCELLATION_CODES)[number];
