import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EmailService } from '../../../../integrations/email/email.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class ShipmentNotificationHandler {
  private readonly logger = new Logger(ShipmentNotificationHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @OnEvent('shipping.shipment.dispatched')
  async handleShipmentDispatched(event: DomainEvent): Promise<void> {
    try {
      const { subOrderId, awb, courierName } = event.payload as any;

      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          masterOrder: {
            include: { customer: { select: { email: true, firstName: true } } },
          },
        },
      });

      if (!subOrder?.masterOrder?.customer?.email) return;

      const customer = subOrder.masterOrder.customer;
      await this.emailService.send({
        to: customer.email,
        subject: `Order Shipped — ${subOrder.masterOrder.orderNumber}`,
        html: `<h2>Your Order Has Been Shipped!</h2>
          <p>Hi ${customer.firstName},</p>
          <p>Your order <strong>${subOrder.masterOrder.orderNumber}</strong> has been dispatched.</p>
          ${awb ? `<p>Tracking: <strong>${awb}</strong> via ${courierName || 'courier'}</p>` : ''}`,
      });

      this.logger.log(`Shipment dispatch email sent for sub-order ${subOrderId}`);
    } catch (error) {
      this.logger.error(`Shipment notification failed: ${(error as Error).message}`);
    }
  }

  @OnEvent('shipping.shipment.delivered')
  async handleShipmentDelivered(event: DomainEvent): Promise<void> {
    try {
      const { subOrderId } = event.payload as any;

      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          masterOrder: {
            include: { customer: { select: { email: true, firstName: true } } },
          },
        },
      });

      if (!subOrder?.masterOrder?.customer?.email) return;

      const customer = subOrder.masterOrder.customer;
      await this.emailService.send({
        to: customer.email,
        subject: `Order Delivered — ${subOrder.masterOrder.orderNumber}`,
        html: `<h2>Your Order Has Been Delivered!</h2>
          <p>Hi ${customer.firstName},</p>
          <p>Your order <strong>${subOrder.masterOrder.orderNumber}</strong> has been delivered.</p>
          <p>If you have any issues, you can request a return within 7 days.</p>`,
      });

      this.logger.log(`Delivery confirmation email sent for sub-order ${subOrderId}`);
    } catch (error) {
      this.logger.error(`Delivery notification failed: ${(error as Error).message}`);
    }
  }
}
