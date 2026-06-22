import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ShipmentRepository } from '../../infrastructure/repositories/shipment.repository';
import { DefaultCourierGatewayResolver } from '../factories/courier-gateway.resolver';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import type {
  AddressLike,
  CreateShipmentPayload,
} from '../ports/outbound/courier-gateway.port';
import type {
  AddressSnapshot,
  CreateShipmentRequest,
  CreateShipmentResponse,
} from '../dto';

/**
 * Books a shipment with a courier and returns the AWB + label.
 *
 * Phase 1 (2026-06-02) — real Delhivery booking, STATELESS. Resolves the
 * partner adapter (default DELHIVERY; honours partnerHint) and calls
 * adapter.createShipment(). Persistence is intentionally deferred: apps/api
 * is the system of record for the Shipment row, so the facade acts as a
 * stateless courier proxy here. (The original M1 design persisted a row +
 * published shipment.created; that lands when the facade ShipmentRepository
 * is implemented — see GetShipmentService / CancelShipmentService, still
 * stubbed because they need a persisted id→AWB lookup.)
 */
@Injectable()
export class CreateShipmentService {
  constructor(
    private readonly repo: ShipmentRepository,
    private readonly resolver: DefaultCourierGatewayResolver,
    private readonly events: EventBusService,
  ) {}

  async execute(req: CreateShipmentRequest): Promise<CreateShipmentResponse> {
    // Persistence + event publish land with the ShipmentRepository impl.
    void this.repo;
    void this.events;

    const partner = req.partnerHint ?? 'DELHIVERY';
    const adapter = this.resolver.forPartner(partner);

    const payload: CreateShipmentPayload = {
      subOrderId: req.subOrderId,
      orderReference: req.orderReference,
      sellerName: req.sellerName,
      sellerAddress: req.sellerAddress,
      sellerGstin: req.sellerGstin,
      pickupWarehouseName: req.pickupWarehouseName,
      // Delhivery books against the configured pickup warehouse (facade .env
      // DELHIVERY_PICKUP_WAREHOUSE_NAME), so these address ids aren't used by
      // the Delhivery adapter — pass the pincode as a stable, non-empty value.
      pickupAddressId: req.pickup.pincode,
      returnAddressId: req.pickup.pincode,
      weightGrams: req.weightGrams,
      dimensionsCm: req.dimensions,
      declaredValuePaise: req.declaredValuePaise,
      cod: req.cod,
      codAmountPaise: req.codAmountPaise,
      pickup: toAddressLike(req.pickup),
      drop: toAddressLike(req.drop),
      items: req.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        quantity: i.quantity,
        unitValuePaise: i.unitValuePaise,
      })),
      // 'reverse' → adapter books a Delhivery reverse pickup (RVP) instead of a
      // forward shipment. Defaults to 'forward'.
      direction: req.direction ?? 'forward',
      // NDD vs standard. Caller-decided; the Delhivery mapper defaults to 'D'.
      transportSpeed: req.transportSpeed,
    };

    const result = await adapter.createShipment(payload);

    return {
      shipmentId: randomUUID(),
      orderId: req.orderId,
      subOrderId: req.subOrderId,
      partner,
      awb: result.awb ?? null,
      carrierOrderRef: result.carrierOrderRef ?? null,
      status: result.success ? 'BOOKED' : 'DRAFT',
      labelUrl: result.labelUrl ?? null,
      trackingUrl: result.trackingUrl ?? null,
      bookedAt: result.success ? new Date().toISOString() : null,
    };
  }
}

function toAddressLike(a: AddressSnapshot): AddressLike {
  return {
    name: a.name,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    country: a.country,
  };
}
