import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { NotificationsPublicFacade } from '../../../notifications/application/facades/notifications-public.facade';

/**
 * Phase 166 (Payment Status Poller audit #12) — consumer for
 * `payments.payment.expired`. The poller's cancel-expired path emitted this
 * event with no subscriber, so a customer whose payment window lapsed got no
 * "your payment expired — please retry" notification and the event left no
 * audit trail. This handler closes both.
 */
@Injectable()
export class OrderExpiredHandler {
  private readonly logger = new Logger(OrderExpiredHandler.name);

  constructor(
    private readonly audit: AuditPublicFacade,
    private readonly notifications: NotificationsPublicFacade,
  ) {}

  @OnEvent('payments.payment.expired')
  async handle(event: DomainEvent): Promise<void> {
    const p = event.payload as {
      masterOrderId: string;
      orderNumber: string;
      customerId: string | null;
      reason?: string;
    };

    // Audit trail (compliance — the cancellation reason on record).
    await this.audit
      .writeAuditLog({
        actorId: 'SYSTEM_PAYMENT_POLLER',
        actorRole: 'SYSTEM',
        action: 'payments.payment.expired',
        module: 'payments',
        resource: 'master_order',
        resourceId: p.masterOrderId,
        metadata: { orderNumber: p.orderNumber, reason: p.reason ?? null },
      })
      .catch((err) =>
        this.logger.error(
          `expired-audit failed for ${p.orderNumber}: ${(err as Error).message}`,
        ),
      );

    // Best-effort customer notification (never throws out of the handler).
    if (p.customerId) {
      await this.notifications
        .sendNotification({
          recipientId: p.customerId,
          channel: 'email',
          templateKey: 'order.payment_window_expired',
          data: {
            orderNumber: p.orderNumber,
            subject: `Payment window expired for order ${p.orderNumber}`,
            body:
              `Your payment window for order ${p.orderNumber} has expired and the order was cancelled. ` +
              `If you'd still like the items, please place the order again.`,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `expired-notify failed for ${p.orderNumber}: ${(err as Error).message}`,
          ),
        );
    }
  }
}
