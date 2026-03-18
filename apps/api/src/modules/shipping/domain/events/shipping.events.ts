export const SHIPPING_EVENTS = {
  SHIPMENT_CREATED: 'shipping.shipment.created',
  AWB_ASSIGNED: 'shipping.awb.assigned',
  LABEL_GENERATED: 'shipping.label.generated',
  TRACKING_UPDATED: 'shipping.tracking.updated',
  NDR_RAISED: 'shipping.ndr.raised',
  NDR_RESOLVED: 'shipping.ndr.resolved',
  RTO_INITIATED: 'shipping.rto.initiated',
  RTO_DELIVERED: 'shipping.rto.delivered',
} as const;
