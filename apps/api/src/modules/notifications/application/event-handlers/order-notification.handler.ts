import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailService } from '../../../../integrations/email/email.service';

@Injectable()
export class OrderNotificationHandler {
  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('OrderNotificationHandler');
  }

  private async getMasterOrderContext(masterOrderId: string) {
    return this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      include: {
        customer: { select: { firstName: true, lastName: true, email: true } },
        subOrders: {
          select: {
            id: true,
            fulfillmentStatus: true,
            fulfillmentNodeType: true,
            sellerId: true,
            franchiseId: true,
            trackingNumber: true,
            courierName: true,
          },
        },
      },
    });
  }

  private async getSubOrderContext(subOrderId: string) {
    return this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        masterOrder: {
          include: {
            customer: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        items: { select: { productTitle: true, quantity: true, unitPrice: true } },
      },
    });
  }

  private wrapTemplate(content: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #1f2937; margin: 0;">SPORTSMART</h2>
        </div>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px;">
          ${content}
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 24px;">
          Thank you for shopping with SPORTSMART. If you have questions, contact our support team.
        </p>
      </div>
    `;
  }

  @OnEvent('orders.master.created')
  async onOrderPlaced(event: DomainEvent<{ masterOrderId: string; orderNumber: string; totalAmount: number; itemCount: number }>) {
    try {
      const order = await this.getMasterOrderContext(event.payload.masterOrderId);
      if (!order?.customer?.email) return;
      const name = `${order.customer.firstName} ${order.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #16a34a; margin-top: 0;">Order Placed Successfully</h3>
        <p>Hi ${name},</p>
        <p>We've received your order. Thank you for shopping with SPORTSMART!</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Order Number:</strong> ${event.payload.orderNumber}</p>
          <p style="margin: 4px 0;"><strong>Items:</strong> ${event.payload.itemCount}</p>
          <p style="margin: 4px 0;"><strong>Total Amount:</strong> \u20B9${Number(event.payload.totalAmount).toFixed(2)}</p>
          <p style="margin: 4px 0;"><strong>Payment Method:</strong> ${order.paymentMethod}</p>
        </div>
        <p>We'll notify you when your order is shipped.</p>
      `;

      await this.emailService.send({
        to: order.customer.email,
        subject: `Order Confirmed - ${event.payload.orderNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send order.master.created email: ${(err as Error).message}`);
    }
  }

  @OnEvent('payments.payment.captured')
  async onPaymentReceived(event: DomainEvent<{ masterOrderId: string; orderNumber: string; amount: number; paymentMethod: string; paymentReference?: string }>) {
    try {
      const order = await this.getMasterOrderContext(event.payload.masterOrderId);
      if (!order?.customer?.email) return;
      const name = `${order.customer.firstName} ${order.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #16a34a; margin-top: 0;">Payment Received</h3>
        <p>Hi ${name},</p>
        <p>We've received your payment for order <strong>${event.payload.orderNumber}</strong>.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Amount:</strong> \u20B9${Number(event.payload.amount).toFixed(2)}</p>
          <p style="margin: 4px 0;"><strong>Payment Method:</strong> ${event.payload.paymentMethod}</p>
          ${event.payload.paymentReference ? `<p style="margin: 4px 0;"><strong>Reference:</strong> ${event.payload.paymentReference}</p>` : ''}
        </div>
        <p>Your order is being processed and will be shipped soon.</p>
      `;

      await this.emailService.send({
        to: order.customer.email,
        subject: `Payment Received - ${event.payload.orderNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send payments.payment.captured email: ${(err as Error).message}`);
    }
  }

  @OnEvent('orders.sub_order.status_changed')
  async onSubOrderStatusChanged(event: DomainEvent<{ subOrderId: string; previousStatus: string; newStatus: string }>) {
    try {
      // Only send email when sub-order is SHIPPED
      if (event.payload.newStatus !== 'SHIPPED') return;

      const subOrder = await this.getSubOrderContext(event.payload.subOrderId);
      if (!subOrder?.masterOrder?.customer?.email) return;
      const name = `${subOrder.masterOrder.customer.firstName} ${subOrder.masterOrder.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #2563eb; margin-top: 0;">Your Order is Shipped</h3>
        <p>Hi ${name},</p>
        <p>Your order <strong>${subOrder.masterOrder.orderNumber}</strong> has been shipped and is on its way to you.</p>
        ${subOrder.trackingNumber ? `
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          ${subOrder.courierName ? `<p style="margin: 4px 0;"><strong>Courier:</strong> ${subOrder.courierName}</p>` : ''}
          <p style="margin: 4px 0;"><strong>Tracking Number:</strong> ${subOrder.trackingNumber}</p>
        </div>
        ` : ''}
        <p>You'll receive another notification once your order is delivered.</p>
      `;

      await this.emailService.send({
        to: subOrder.masterOrder.customer.email,
        subject: `Order Shipped - ${subOrder.masterOrder.orderNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send orders.sub_order.status_changed email: ${(err as Error).message}`);
    }
  }

  /**
   * Notify the fulfillment node (seller OR franchise) when a sub-order has
   * been freshly assigned to them — either via admin verify (bulk creation)
   * or admin reassignment. Before this handler, nodes only learned about
   * new orders by polling their dashboard.
   */
  private async notifyFulfillmentNode(subOrderId: string, isReassignment: boolean) {
    try {
      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: {
          masterOrder: { select: { orderNumber: true } },
          items: { select: { productTitle: true, quantity: true } },
        },
      });
      if (!subOrder) return;

      // Resolve the recipient based on which node owns the sub-order. The
      // `fulfillmentNodeType` column discriminates; we fall back to sellerId
      // presence for rows written before the column was populated.
      const nodeType =
        (subOrder as any).fulfillmentNodeType ||
        ((subOrder as any).franchiseId ? 'FRANCHISE' : 'SELLER');

      let recipientEmail: string | null = null;
      let recipientName = '';
      if (nodeType === 'SELLER' && subOrder.sellerId) {
        const seller = await this.prisma.seller.findUnique({
          where: { id: subOrder.sellerId },
          select: { email: true, sellerName: true, sellerShopName: true },
        });
        recipientEmail = seller?.email ?? null;
        recipientName = seller?.sellerName || seller?.sellerShopName || '';
      } else if (nodeType === 'FRANCHISE' && (subOrder as any).franchiseId) {
        const franchise = await this.prisma.franchisePartner.findUnique({
          where: { id: (subOrder as any).franchiseId },
          select: { email: true, ownerName: true, businessName: true },
        });
        recipientEmail = franchise?.email ?? null;
        recipientName = franchise?.ownerName || franchise?.businessName || '';
      }
      if (!recipientEmail) return;

      const itemSummary = subOrder.items
        .map((i) => `&bull; ${i.quantity} \u00D7 ${i.productTitle}`)
        .join('<br>');

      const verb = isReassignment ? 'Reassigned' : 'New';
      const intro = isReassignment
        ? 'A sub-order has been reassigned to you. Please review and accept or reject within the deadline.'
        : 'A new order has been assigned to you. Please review and accept or reject within the deadline.';

      const content = `
        <h3 style="color: #2563eb; margin-top: 0;">${verb} order: ${subOrder.masterOrder.orderNumber}</h3>
        <p>Hi ${recipientName || 'there'},</p>
        <p>${intro}</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Order:</strong> ${subOrder.masterOrder.orderNumber}</p>
          <p style="margin: 4px 0;"><strong>Items:</strong><br>${itemSummary}</p>
          ${subOrder.acceptDeadlineAt ? `<p style="margin: 4px 0;"><strong>Accept by:</strong> ${new Date(subOrder.acceptDeadlineAt).toLocaleString()}</p>` : ''}
        </div>
        <p>Open your dashboard to review the details and respond.</p>
      `;

      await this.emailService.send({
        to: recipientEmail,
        subject: `${verb} order assigned - ${subOrder.masterOrder.orderNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send node-assignment email for sub-order ${subOrderId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('orders.master.routed')
  async onOrderRouted(
    event: DomainEvent<{ masterOrderId: string; subOrderCount: number }>,
  ) {
    // Fetch all sub-orders on this master and notify each assigned node.
    try {
      const subOrders = await this.prisma.subOrder.findMany({
        where: { masterOrderId: event.payload.masterOrderId },
        select: { id: true },
      });
      for (const so of subOrders) {
        await this.notifyFulfillmentNode(so.id, false);
      }
    } catch (err) {
      this.logger.error(
        `Failed to dispatch routed notifications: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('orders.sub_order.reassigned')
  async onSubOrderReassigned(event: DomainEvent<{ subOrderId: string }>) {
    await this.notifyFulfillmentNode(event.payload.subOrderId, true);
  }

  @OnEvent('orders.sub_order.created')
  async onNewSubOrderCreated(event: DomainEvent<{ subOrderId: string }>) {
    // Auto-reallocation after a rejection creates a fresh sub-order for a
    // new node — treat it like a reassignment so the new node is notified.
    await this.notifyFulfillmentNode(event.payload.subOrderId, true);
  }

  @OnEvent('orders.sub_order.delivered')
  async onOrderDelivered(event: DomainEvent<{ subOrderId: string; masterOrderId: string; deliveredAt: Date }>) {
    try {
      const subOrder = await this.getSubOrderContext(event.payload.subOrderId);
      if (!subOrder?.masterOrder?.customer?.email) return;
      const name = `${subOrder.masterOrder.customer.firstName} ${subOrder.masterOrder.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #16a34a; margin-top: 0;">Your Order is Delivered</h3>
        <p>Hi ${name},</p>
        <p>Your order <strong>${subOrder.masterOrder.orderNumber}</strong> has been delivered. We hope you love your purchase!</p>
        <p>If anything is wrong with your order, you can request a return from your order history within the return window.</p>
        <p>Thank you for shopping with SPORTSMART!</p>
      `;

      await this.emailService.send({
        to: subOrder.masterOrder.customer.email,
        subject: `Order Delivered - ${subOrder.masterOrder.orderNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send orders.sub_order.delivered email: ${(err as Error).message}`);
    }
  }
}
