import { Injectable, NotImplementedException } from '@nestjs/common';
import { ShipmentRepository } from '../../infrastructure/repositories/shipment.repository';
import { DefaultCourierGatewayResolver } from '../factories/courier-gateway.resolver';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import type { CancelShipmentRequest, ShipmentResponse } from '../dto';

/**
 * Cancels a shipment (pre-pickup only — post-pickup goes through the
 * RTO flow). M0 stub; full flow lands in M1.
 *
 * Steps when the body lands:
 *   1. Load shipment; reject if status not in {DRAFT, BOOKED, PICKED_UP}.
 *   2. If cancelWithPartner=true and an AWB exists, call adapter.cancelShipment.
 *   3. Transition Shipment.status -> CANCELLED via assertTransition().
 *   4. Publish shipment.cancelled with reason + cancelledByPartner=true|false.
 */
@Injectable()
export class CancelShipmentService {
  constructor(
    private readonly repo: ShipmentRepository,
    private readonly resolver: DefaultCourierGatewayResolver,
    private readonly events: EventBusService,
  ) {}

  async execute(
    _id: string,
    _req: CancelShipmentRequest,
  ): Promise<ShipmentResponse> {
    void this.repo;
    void this.resolver;
    void this.events;
    throw new NotImplementedException('Stub — implement in M1');
  }
}
