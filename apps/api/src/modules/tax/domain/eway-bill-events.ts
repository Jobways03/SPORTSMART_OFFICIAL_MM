// Phase 89 (2026-05-23) — Shipment Evidence audit Gap #15.
//
// Pre-Phase-89 the EWB service mutated rows in silence — fraud
// detection / settlement / customer notification / SIEM consumers had
// no signal to react to. These constants give downstream subscribers
// a stable contract.

export const EWAY_BILL_EVENTS = {
  CLASSIFIED: 'tax.ewayBill.classified',
  GENERATED: 'tax.ewayBill.generated',
  CANCELLED: 'tax.ewayBill.cancelled',
  EXPIRED: 'tax.ewayBill.expired',
  FAILED: 'tax.ewayBill.failed',
  OVERRIDDEN: 'tax.ewayBill.overridden',
  OVERRIDE_REVOKED: 'tax.ewayBill.override_revoked',
  // Phase 160 (audit #18) — Part-B (transport) updated without cancelling.
  PART_B_UPDATED: 'tax.ewayBill.part_b_updated',
} as const;

// Phase 89 — Gap #26. Override reason categories. Free-text "ok"
// passed audit before; enum + per-category min length closes the gap.
export type EWayBillOverrideReasonCategory =
  | 'URGENT_DISPATCH'
  | 'NIC_OUTAGE'
  | 'TEST_SHIPMENT'
  | 'GST_EXEMPT'
  | 'OTHER';
