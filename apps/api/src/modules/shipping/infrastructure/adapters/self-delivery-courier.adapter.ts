import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CarrierCapabilityError,
  type CancelShipmentResult,
  type CourierAdapterMeta,
  type CourierGatewayPort,
  type CreateShipmentRequest,
  type CreateShipmentResult,
  type NdrActionResult,
  type PrintLabelResult,
  type RegisterPickupRequest,
  type RegisterPickupResult,
  type ServiceabilityResult,
  type TrackingSnapshot,
} from '../../application/ports/outbound/courier-gateway.port';

/**
 * `CourierGatewayPort` implementation for the SELF_DELIVERY path.
 *
 * No external API. Every "courier" operation is just a DB write —
 * `createShipment` flips the SubOrder into PENDING self-delivery
 * state, `track` reads back what the seller / franchise has been
 * recording, etc.
 *
 * Capabilities that have no analogue (label / manifest / NDR
 * reattempt routed through a real courier) throw
 * `CarrierCapabilityError`. The UI knows not to surface those
 * buttons for self-delivery shipments.
 */
@Injectable()
export class SelfDeliveryCourierAdapter implements CourierGatewayPort {
  private readonly logger = new Logger(SelfDeliveryCourierAdapter.name);

  readonly meta: CourierAdapterMeta = {
    method: 'SELF_DELIVERY',
    carrier: 'self-delivery',
  };

  constructor(private readonly prisma: PrismaService) {}

  /** Self-delivery serves anywhere the seller / franchise serves. */
  async checkServiceability(pincode: string): Promise<ServiceabilityResult> {
    return {
      pincode,
      serviceable: true,
      codAvailable: true,
      prepaidAvailable: true,
      carriers: [
        {
          carrier: 'self-delivery',
          prepaid: true,
          cod: true,
          pickup: true,
        },
      ],
    };
  }

  /**
   * Self-delivery doesn't need iThink-side registration — there's no
   * carrier to know about us. Return a deterministic id derived from
   * the owner so the rest of the code path treats this uniformly with
   * iThink.
   */
  async registerPickup(req: RegisterPickupRequest): Promise<RegisterPickupResult> {
    return {
      pickupAddressId: `self:${req.ownerType.toLowerCase()}:${req.ownerId}`,
      approvalStatus: 'APPROVED',
      remark: 'self-delivery requires no carrier registration',
    };
  }

  /**
   * Flip the SubOrder into self-delivery PENDING state. No AWB,
   * no tracking url — those concepts don't apply. Returns
   * `success: true` so the use case can mark the SubOrder accepted.
   */
  async createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResult> {
    await this.prisma.subOrder.update({
      where: { id: req.subOrderId },
      data: {
        deliveryMethod: 'SELF_DELIVERY',
        selfDeliveryStatus: 'PENDING',
        pickupAddressIdSnapshot: req.pickupAddressId,
      },
    });

    this.logger.log(
      `Self-delivery shipment registered for sub-order ${req.subOrderId}`,
    );

    return {
      subOrderId: req.subOrderId,
      success: true,
      carrier: 'self-delivery',
    };
  }

  /**
   * Self-delivery uses our own delivery slip (generated elsewhere) —
   * no equivalent of a courier label.
   */
  async printLabel(_awbs: string[]): Promise<PrintLabelResult> {
    throw new CarrierCapabilityError('SelfDeliveryCourierAdapter', 'printLabel');
  }

  /**
   * "Tracking" for self-delivery is just the SubOrder's
   * selfDeliveryStatus. AWBs here are SubOrder ids (since there's no
   * real AWB) — caller passes them via the adapter contract.
   */
  async track(awbs: string[]): Promise<Map<string, TrackingSnapshot>> {
    const subOrders = await this.prisma.subOrder.findMany({
      where: { id: { in: awbs } },
      select: {
        id: true,
        selfDeliveryStatus: true,
        selfDeliveredAt: true,
        selfDeliveryNotes: true,
        deliveredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const result = new Map<string, TrackingSnapshot>();
    for (const so of subOrders) {
      result.set(so.id, {
        awb: so.id,
        carrier: 'self-delivery',
        direction: 'forward',
        currentStatus: mapSelfDeliveryToInternal(so.selfDeliveryStatus),
        rawCurrentStatus: so.selfDeliveryStatus ?? 'PENDING',
        scans: [
          {
            status: mapSelfDeliveryToInternal(so.selfDeliveryStatus),
            rawStatus: so.selfDeliveryStatus ?? 'PENDING',
            rawStatusCode: 'SELF',
            scanLocation: 'Seller/Franchise',
            remark: so.selfDeliveryNotes ?? '',
            scanAt: so.updatedAt ?? so.createdAt,
          },
        ],
      });
    }
    return result;
  }

  /**
   * Cancel a self-delivery shipment — flip status to CANCELLED.
   * `awb` here is the SubOrder id (no real AWB exists).
   */
  async cancelShipment(awb: string): Promise<CancelShipmentResult> {
    await this.prisma.subOrder.update({
      where: { id: awb },
      data: { selfDeliveryStatus: 'CANCELLED' },
    });
    return { awb, success: true };
  }

  async reattempt(_input: {
    awb: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult> {
    throw new CarrierCapabilityError('SelfDeliveryCourierAdapter', 'reattempt');
  }

  async initiateRto(_input: { awb: string; remark: string }): Promise<NdrActionResult> {
    throw new CarrierCapabilityError('SelfDeliveryCourierAdapter', 'initiateRto');
  }
}

/**
 * Map SelfDeliveryStatus enum onto the shared ShipmentStatusInternal
 * vocabulary used by the rest of the shipping module. Keeps the
 * `currentStatus` field comparable between iThink and self-delivery
 * shipments for unified order-list rendering.
 */
function mapSelfDeliveryToInternal(status: string | null | undefined): string {
  switch (status) {
    case 'READY_FOR_PICKUP':
      return 'MANIFESTED';
    case 'OUT_FOR_DELIVERY':
      return 'OUT_FOR_DELIVERY';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'FAILED':
      return 'UNDELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}
