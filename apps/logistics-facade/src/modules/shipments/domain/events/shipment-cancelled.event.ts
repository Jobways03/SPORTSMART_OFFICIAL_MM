import type { DomainEvent } from '../../../../bootstrap/events/event-bus.service';

/**
 * Emitted after a shipment is cancelled (customer-initiated, ops
 * intervention, or partner-side cancellation reconciled in via cron).
 * Notifications / refund instructions / liability ledger reverse
 * entries hang off this event.
 */
export interface ShipmentCancelledEvent extends DomainEvent {
  readonly name: 'shipment.cancelled';
  readonly payload: {
    shipmentId: string;
    orderId: string;
    subOrderId: string;
    partner: string;
    awb: string | null;
    reason: string;
    cancelledByPartner: boolean;
  };
}

export function shipmentCancelledEvent(
  payload: ShipmentCancelledEvent['payload'],
): ShipmentCancelledEvent {
  return {
    name: 'shipment.cancelled',
    occurredAt: new Date().toISOString(),
    payload,
  };
}
