import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from '../../../../integrations/email/email.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';

@Injectable()
export class PaymentNotificationHandler {
  private readonly logger = new Logger(PaymentNotificationHandler.name);

  constructor(
    private readonly ordersFacade: OrdersPublicFacade,
    private readonly emailService: EmailService,
  ) {}

  @OnEvent('payments.payment.captured')
  async handlePaymentCaptured(event: DomainEvent): Promise<void> {
    try {
      const { masterOrderId, amount, orderNumber } = event.payload as any;

      const order = await this.ordersFacade.getMasterOrder(masterOrderId);
      if (!order?.customer?.email) return;

      await this.emailService.send({
        to: order.customer.email,
        subject: `Payment Confirmed — Order ${orderNumber || order.orderNumber}`,
        html: `<h2>Payment Received</h2>
          <p>Hi ${order.customer.firstName},</p>
          <p>We've received your payment of <strong>₹${amount || order.totalAmount}</strong> for order <strong>${order.orderNumber}</strong>.</p>
          <p>Your order is now being processed!</p>`,
      });

      this.logger.log(`Payment confirmation email sent for order ${order.orderNumber}`);
    } catch (error) {
      this.logger.error(`Payment notification failed: ${(error as Error).message}`);
    }
  }

  @OnEvent('payments.payment.failed')
  async handlePaymentFailed(event: DomainEvent): Promise<void> {
    try {
      const { masterOrderId } = event.payload as any;

      const order = await this.ordersFacade.getMasterOrder(masterOrderId);
      if (!order?.customer?.email) return;

      await this.emailService.send({
        to: order.customer.email,
        subject: `Payment Issue — Order ${order.orderNumber}`,
        html: `<h2>Payment Failed</h2>
          <p>Hi ${order.customer.firstName},</p>
          <p>Your payment for order <strong>${order.orderNumber}</strong> could not be processed.</p>
          <p>Please try again or use a different payment method.</p>`,
      });

      this.logger.log(`Payment failure email sent for order ${order.orderNumber}`);
    } catch (error) {
      this.logger.error(`Payment failure notification failed: ${(error as Error).message}`);
    }
  }
}
