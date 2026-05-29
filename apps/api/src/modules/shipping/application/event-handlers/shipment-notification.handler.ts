import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EmailService } from '../../../../integrations/email/email.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { safeHtml, rawHtml } from '../../../../core/util/escape-html';

@Injectable()
export class ShipmentNotificationHandler {
  private readonly logger = new Logger(ShipmentNotificationHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    // Phase 2 / M21-M32 — outbox-replay dedup. See wallet handler.
    protected readonly eventDedup: EventDeduplicationService,
  ) {}

  @OnEvent('shipping.shipment.dispatched')
  @IdempotentHandler()
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
      // AWB + courier come from carrier webhook payloads, so they're
      // external input. Escape every interpolation via safeHtml.
      const trackingRow = awb
        ? safeHtml`<p>Tracking: <strong>${awb}</strong> via ${courierName || 'courier'}</p>`
        : '';
      await this.emailService.send({
        to: customer.email,
        subject: `Order Shipped — ${subOrder.masterOrder.orderNumber}`,
        html: safeHtml`<h2>Your Order Has Been Shipped!</h2>
          <p>Hi ${customer.firstName},</p>
          <p>Your order <strong>${subOrder.masterOrder.orderNumber}</strong> has been dispatched.</p>
          ${rawHtml(trackingRow)}`,
      });

      this.logger.log(`Shipment dispatch email sent for sub-order ${subOrderId}`);
    } catch (error) {
      this.logger.error(`Shipment notification failed: ${(error as Error).message}`);
    }
  }

  // Phase 87 (2026-05-23) — NDR/RTO audit Gap #12. Customer email
  // on each failed delivery attempt. IdempotentHandler + the event
  // payload's `attemptNumber` (Gap #17) means a duplicate webhook
  // delivery doesn't re-send.
  @OnEvent('shipping.ndr.raised')
  @IdempotentHandler()
  async handleNdrRaised(event: DomainEvent): Promise<void> {
    try {
      const { subOrderId, awb, attemptNumber, reason } = event.payload as any;
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
      const reasonLine = reason
        ? safeHtml`<p>Reason: <em>${reason}</em></p>`
        : '';
      const attemptLine = attemptNumber
        ? safeHtml`<p>Attempt #${String(attemptNumber)}</p>`
        : '';
      await this.emailService.send({
        to: customer.email,
        subject: `Delivery attempted — ${subOrder.masterOrder.orderNumber}`,
        html: safeHtml`<h2>We tried to deliver your order</h2>
          <p>Hi ${customer.firstName},</p>
          <p>Our courier partner could not complete delivery for your order
          <strong>${subOrder.masterOrder.orderNumber}</strong>${awb ? ` (AWB ${awb})` : ''}.</p>
          ${rawHtml(reasonLine)}
          ${rawHtml(attemptLine)}
          <p>The carrier will retry, or you can choose a different option from
          your order page.</p>`,
      });
      this.logger.log(
        `NDR notification sent for sub-order ${subOrderId} (attempt=${attemptNumber})`,
      );
    } catch (error) {
      this.logger.error(`NDR notification failed: ${(error as Error).message}`);
    }
  }

  // Phase 87 — Gap #12 / #13. RTO_INITIATED notification. Customer
  // gets "Your order is being returned to the seller" so the 7-14d
  // RTO journey doesn't surprise them with a sudden CANCELLED.
  @OnEvent('shipping.rto.initiated')
  @IdempotentHandler()
  async handleRtoInitiated(event: DomainEvent): Promise<void> {
    try {
      const { subOrderId, awb, reason } = event.payload as any;
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
      const reasonLine = reason
        ? safeHtml`<p>Reason: <em>${reason}</em></p>`
        : '';
      await this.emailService.send({
        to: customer.email,
        subject: `Order returning to seller — ${subOrder.masterOrder.orderNumber}`,
        html: safeHtml`<h2>Your order is being returned</h2>
          <p>Hi ${customer.firstName},</p>
          <p>Your order <strong>${subOrder.masterOrder.orderNumber}</strong>${
            awb ? ` (AWB ${awb})` : ''
          } is being returned to the seller.</p>
          ${rawHtml(reasonLine)}
          <p>If you paid online, your refund will be initiated once the goods
          reach the seller.</p>`,
      });
      this.logger.log(`RTO_INITIATED notification sent for sub-order ${subOrderId}`);
    } catch (error) {
      this.logger.error(
        `RTO_INITIATED notification failed: ${(error as Error).message}`,
      );
    }
  }

  // Phase 87 — Gap #12. RTO_DELIVERED notification — refund acknowledged.
  @OnEvent('shipping.rto.delivered')
  @IdempotentHandler()
  async handleRtoDelivered(event: DomainEvent): Promise<void> {
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
        subject: `Refund initiated — ${subOrder.masterOrder.orderNumber}`,
        html: safeHtml`<h2>Refund initiated</h2>
          <p>Hi ${customer.firstName},</p>
          <p>Your order <strong>${subOrder.masterOrder.orderNumber}</strong>
          has been returned to the seller. We've initiated your refund — it
          should reach your original payment method within 5-7 business days.</p>`,
      });
      this.logger.log(`RTO_DELIVERED notification sent for sub-order ${subOrderId}`);
    } catch (error) {
      this.logger.error(
        `RTO_DELIVERED notification failed: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent('shipping.shipment.delivered')
  @IdempotentHandler()
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
        html: safeHtml`<h2>Your Order Has Been Delivered!</h2>
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
