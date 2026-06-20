import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { NotificationsPublicFacade } from '../../../notifications/application/facades/notifications-public.facade';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';

/**
 * Phase 166 (Payment Status Poller audit #12) — consumer for
 * `payments.payment.expired`. The poller's cancel-expired path emitted this
 * event with no subscriber, so a customer whose payment window lapsed got no
 * "your payment expired — please retry" notification and the event left no
 * audit trail. This handler closes both.
 *
 * Online-payment audit (#5) — it ALSO now refunds the wallet portion. An
 * online order that applied wallet at checkout has that wallet amount DEBITED
 * at place-order, before the gateway leg. If the customer never completes the
 * gateway payment and the window expires, the order is cancelled but the wallet
 * money was previously stranded (manual finance intervention). Refunding here
 * (idempotent saga, keyed on order+customer+amount) covers BOTH the poller's
 * cancel-expired path and the payment-expiry-sweep — whichever cancels the
 * order emits this event. The saga writes the wallet credit ledger row, so the
 * refund is fully auditable.
 */
@Injectable()
export class OrderExpiredHandler {
  private readonly logger = new Logger(OrderExpiredHandler.name);

  constructor(
    private readonly audit: AuditPublicFacade,
    private readonly notifications: NotificationsPublicFacade,
    private readonly prisma: PrismaService,
    private readonly wallet: WalletPublicFacade,
  ) {}

  @OnEvent('payments.payment.expired')
  async handle(event: DomainEvent): Promise<void> {
    const p = event.payload as {
      masterOrderId: string;
      orderNumber: string;
      customerId: string | null;
      reason?: string;
    };

    // Refund any wallet portion that was debited at place-order. Idempotent:
    // the saga dedupes on (orderId, customerId, amount), so a re-delivered
    // event (or both expiry crons racing) credits the customer at most once.
    try {
      const order = await this.prisma.masterOrder.findUnique({
        where: { id: p.masterOrderId },
        select: { customerId: true, walletAmountUsedInPaise: true },
      });
      const walletPaise = order ? BigInt(order.walletAmountUsedInPaise) : 0n;
      if (order && walletPaise > 0n && order.customerId) {
        await this.wallet.enqueueCheckoutCancellationRefund({
          customerId: order.customerId,
          orderId: p.masterOrderId,
          amountInPaise: Number(walletPaise),
          reason: `Wallet refund — payment window expired for order ${p.orderNumber}`,
        });
        this.logger.log(
          `Enqueued wallet refund of ${walletPaise} paise for expired order ${p.orderNumber}`,
        );
      }
    } catch (err) {
      // Never throw out of the handler — but log LOUDLY: a failed wallet
      // refund enqueue is a real money-stranding risk, not a notification miss.
      this.logger.error(
        `Wallet refund enqueue FAILED for expired order ${p.orderNumber}: ${(err as Error).message} — finance must reconcile`,
      );
    }

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
