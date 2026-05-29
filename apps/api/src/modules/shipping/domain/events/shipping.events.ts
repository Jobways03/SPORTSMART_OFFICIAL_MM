export const SHIPPING_EVENTS = {
  SHIPMENT_CREATED: 'shipping.shipment.created',
  AWB_ASSIGNED: 'shipping.awb.assigned',
  LABEL_GENERATED: 'shipping.label.generated',
  TRACKING_UPDATED: 'shipping.tracking.updated',
  NDR_RAISED: 'shipping.ndr.raised',
  NDR_RESOLVED: 'shipping.ndr.resolved',
  RTO_INITIATED: 'shipping.rto.initiated',
  RTO_DELIVERED: 'shipping.rto.delivered',
  // Phase 86 (2026-05-23) — Gap #13. Pre-Phase-86 three handlers
  // subscribed to `shipping.shipment.delivered` (notification, audit,
  // business-metrics) but the event was never emitted. Adding to the
  // constant + emitting from `applySnapshot` closes the dangling
  // subscription.
  SHIPMENT_DELIVERED: 'shipping.shipment.delivered',
  // Phase 86 — Gap #7/#27. LOST / DAMAGED carrier statuses publish
  // this event so a refund-saga subscriber initiates a refund
  // automatically. Pre-Phase-86 these statuses left customer money
  // with the platform with no recourse.
  SHIPMENT_LOST: 'shipping.shipment.lost',
  // Phase 88 (2026-05-23) — Shipment Evidence Flow Gap #18.
  // Pre-Phase-88 the upload/delete handlers were silent; fraud
  // detection, analytics, and customer push-notification consumers
  // had no signal to react to. These events fire on every accepted
  // mutation of a ShipmentEvidence row.
  EVIDENCE_UPLOADED: 'shipping.evidence.uploaded',
  EVIDENCE_DELETED: 'shipping.evidence.deleted',
  // POD captured from carrier webhook (kind=POD). Distinct event so
  // a customer-notification subscriber can fire "your delivery
  // photo is ready" without listening to every upload.
  EVIDENCE_POD_CAPTURED: 'shipping.evidence.pod_captured',
} as const;
