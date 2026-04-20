import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

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
    await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: {
        fulfillmentStatus: event.status as any,
      },
    });

    this.logger.log(`Sub-order ${subOrderId} updated to fulfillment status: ${event.status}`);
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
