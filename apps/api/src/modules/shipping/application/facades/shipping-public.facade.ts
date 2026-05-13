import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  isTransitionAllowed,
  type OrderFulfillmentStatus,
} from '../../../../core/fsm/status-transitions';

/**
 * Phase 0 (PR 0.8) — closed set of fulfillment values accepted from
 * upstream tracking-normalizer output. Any string not in this set is
 * rejected by `updateShipmentFromTrackingEvent` rather than being
 * silently coerced via `as any` into the Prisma enum.
 */
const VALID_FULFILLMENT_STATUSES: readonly OrderFulfillmentStatus[] = [
  'UNFULFILLED',
  'PACKED',
  'SHIPPED',
  'FULFILLED',
  'DELIVERED',
  'CANCELLED',
];

/**
 * Shipping facade — uses SubOrder fields (trackingNumber, courierName,
 * fulfillmentStatus, shippingLabelUrl) since there is no dedicated
 * Shipment model in the schema.
 */
@Injectable()
export class ShippingPublicFacade {
  private readonly logger = new Logger(ShippingPublicFacade.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async createShipment(
    subOrderId: string,
    shipmentData: {
      courierName?: string;
      awb?: string;
      trackingUrl?: string;
    },
  ): Promise<{
    subOrderId: string;
    awb: string | null;
    status: string;
  }> {
    const updated = await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: {
        courierName: shipmentData.courierName ?? null,
        trackingNumber: shipmentData.awb ?? null,
        shippingLabelUrl: shipmentData.trackingUrl ?? null,
        fulfillmentStatus: 'SHIPPED',
      },
    });

    this.logger.log(`Shipment info set on sub-order ${subOrderId}`);

    return {
      subOrderId: updated.id,
      awb: updated.trackingNumber,
      status: updated.fulfillmentStatus,
    };
  }

  async getShipmentBySubOrderId(subOrderId: string): Promise<{
    subOrderId: string;
    awb: string | null;
    courierName: string | null;
    status: string;
    trackingUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
    });

    if (!sub) return null;

    return {
      subOrderId: sub.id,
      awb: sub.trackingNumber,
      courierName: sub.courierName,
      status: sub.fulfillmentStatus,
      trackingUrl: sub.shippingLabelUrl,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
  }

  async updateShipmentFromTrackingEvent(
    subOrderId: string,
    event: { status: string; location?: string; timestamp?: Date },
  ): Promise<void> {
    // Phase 0 (PR 0.8) — previously this method cast `event.status as
    // any` and wrote whatever string the tracking normalizer produced
    // into the Prisma enum. A malformed normalizer output would
    // corrupt the sub-order state silently. Now:
    //   1. Reject any value not in the OrderFulfillmentStatus enum
    //   2. Read current sub-order status and assert the FSM matrix
    //      allows the transition
    //   3. Use a status-conditional updateMany so a concurrent admin
    //      cancel doesn't get overwritten by a late tracking event
    if (!VALID_FULFILLMENT_STATUSES.includes(event.status as OrderFulfillmentStatus)) {
      this.logger.warn(
        `Sub-order ${subOrderId}: rejected tracking event with unknown fulfillment status ${event.status}`,
      );
      return;
    }
    const target = event.status as OrderFulfillmentStatus;

    const current = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { fulfillmentStatus: true },
    });
    if (!current) {
      this.logger.warn(
        `Sub-order ${subOrderId}: tracking event for missing sub-order`,
      );
      return;
    }
    if (!isTransitionAllowed('OrderFulfillmentStatus', current.fulfillmentStatus, target)) {
      this.logger.warn(
        `Sub-order ${subOrderId}: skipping illegal fulfillment transition ` +
          `${current.fulfillmentStatus} → ${target} from tracking event`,
      );
      return;
    }

    const result = await this.prisma.subOrder.updateMany({
      where: { id: subOrderId, fulfillmentStatus: current.fulfillmentStatus },
      data: { fulfillmentStatus: target },
    });
    if (result.count === 0) {
      this.logger.log(
        `Sub-order ${subOrderId}: tracking event lost a race against another writer (was ${current.fulfillmentStatus})`,
      );
      return;
    }

    this.logger.log(`Sub-order ${subOrderId} updated to fulfillment status: ${target}`);
  }

  async getNdrRtoState(subOrderId: string): Promise<{
    subOrderId: string;
    status: string;
    isNdr: boolean;
    isRto: boolean;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, fulfillmentStatus: true },
    });

    if (!sub) return null;

    return {
      subOrderId: sub.id,
      status: sub.fulfillmentStatus,
      isNdr: false, // NDR not yet tracked on SubOrder
      isRto: false, // RTO not yet tracked on SubOrder
    };
  }

  async getLabelInfo(subOrderId: string): Promise<{
    subOrderId: string;
    awb: string | null;
    courierName: string | null;
    trackingUrl: string | null;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, trackingNumber: true, courierName: true, shippingLabelUrl: true },
    });

    if (!sub) return null;

    return {
      subOrderId: sub.id,
      awb: sub.trackingNumber,
      courierName: sub.courierName,
      trackingUrl: sub.shippingLabelUrl,
    };
  }

  async validateShipmentStage(subOrderId: string): Promise<{
    subOrderId: string;
    currentStatus: string;
    canDispatch: boolean;
    canDeliver: boolean;
  } | null> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, fulfillmentStatus: true },
    });

    if (!sub) return null;

    const dispatchable = ['UNFULFILLED', 'PACKED'];
    const deliverable = ['SHIPPED'];

    return {
      subOrderId: sub.id,
      currentStatus: sub.fulfillmentStatus,
      canDispatch: dispatchable.includes(sub.fulfillmentStatus),
      canDeliver: deliverable.includes(sub.fulfillmentStatus),
    };
  }
}
