import type { DomainEvent } from '../../../../bootstrap/events/event-bus.service';

/**
 * Emitted after a shipment is successfully booked with a partner.
 * Subscribers (apps/api notifications consumer, BI export) receive
 * just enough payload to lookup the row by id; the full shipment
 * shape is fetched on demand from `GET /admin/shipments/:id`.
 */
export interface ShipmentCreatedEvent extends DomainEvent {
  readonly name: 'shipment.created';
  readonly payload: {
    shipmentId: string;
    orderId: string;
    subOrderId: string;
    partner: string;
    awb: string | null;
  };
}

export function shipmentCreatedEvent(
  payload: ShipmentCreatedEvent['payload'],
): ShipmentCreatedEvent {
  return {
    name: 'shipment.created',
    occurredAt: new Date().toISOString(),
    payload,
  };
}
