import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';
import { PaymentLifecycleService } from '../services/payment-lifecycle.service';

/**
 * Phase 166 (Payment Status Poller audit #1) — the consumer the poller's
 * orphan-recovery always needed.
 *
 * Before: `PaymentStatusPollerService.confirmOrphanedPayments` detected a
 * customer who paid (Razorpay captured) but never returned to the verify
 * endpoint, validated the amount, and emitted `payments.orphan_recovered`
 * — into a vacuum (no subscriber). The order then sat in PENDING_PAYMENT
 * until `cancelExpiredPayments` CANCELLED it and released the stock,
 * despite the customer having paid. Real money-loss + trust incident.
 *
 * This handler CONFIRMS the order. It deliberately does a FULL atomic
 * confirm (orderStatus → PLACED + paymentStatus → PAID + razorpay ids +
 * verificationDeadlineAt) rather than the facade's `markOrderPaid` — that
 * facade only flips paymentStatus and leaves orderStatus=PENDING_PAYMENT,
 * which cancel-expired would then still cancel. The CAS guard
 * (orderStatus=PENDING_PAYMENT) makes it idempotent against the webhook /
 * a concurrent verify / a duplicate orphan event (only one flips).
 */
@Injectable()
export class OrphanRecoveredHandler {
  private readonly logger = new Logger(OrphanRecoveredHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
    private readonly paymentOps: PaymentOpsFacade,
    private readonly paymentLifecycle: PaymentLifecycleService,
  ) {}

  @OnEvent('payments.orphan_recovered')
  async handle(event: DomainEvent): Promise<void> {
    const p = event.payload as {
      masterOrderId: string;
      orderNumber: string;
      razorpayOrderId: string;
      razorpayPaymentId: string;
      capturedAmountInPaise: string;
      customerId: string | null;
    };

    try {
      const order = await this.prisma.masterOrder.findUnique({
        where: { id: p.masterOrderId },
        select: {
          id: true,
          orderStatus: true,
          paymentStatus: true,
          totalAmountInPaise: true,
          orderNumber: true,
          customerId: true,
          paymentMethod: true,
        },
      });
      if (!order) {
        this.logger.warn(`[orphan-confirm] order ${p.masterOrderId} not found`);
        return;
      }

      // Captured payment for an order we already cancelled/rejected (cancel-expired
      // or admin won the race). DO NOT resurrect it — open a refund-grade alert.
      if (order.orderStatus === 'CANCELLED' || order.orderStatus === 'REJECTED') {
        await this.paymentOps
          .flagMismatch({
            kind: 'ORPHAN_PAYMENT',
            masterOrderId: order.id,
            orderNumber: order.orderNumber,
            providerPaymentId: p.razorpayPaymentId,
            expectedInPaise: order.totalAmountInPaise,
            actualInPaise: p.capturedAmountInPaise,
            severity: 99,
            description:
              `[orphan-confirm] Razorpay captured payment ${p.razorpayPaymentId} for order ` +
              `${order.orderNumber} which is already ${order.orderStatus}. Customer was charged ` +
              `but the order is dead — a REFUND is required. Do not auto-confirm.`,
          })
          .catch(() => undefined);
        this.logger.error(
          `[orphan-confirm] captured payment for ${order.orderStatus} order ${order.orderNumber} — refund alert opened`,
        );
        return;
      }

      // Amount guard (defense-in-depth — the poller already checked drift ≤ 1).
      // The poller always emits a valid bigint.toString(); but if a malformed
      // payload ever reaches here, BigInt() would throw and the outer catch
      // would SILENTLY fail to confirm → the order gets cancel-expired (the
      // exact money-loss this handler exists to prevent). Fail LOUD instead:
      // open a refund-grade alert so finance reconciles a real captured payment.
      const expected = BigInt(order.totalAmountInPaise);
      if (!/^\d+$/.test(String(p.capturedAmountInPaise ?? ''))) {
        this.logger.error(
          `[orphan-confirm] malformed capturedAmountInPaise "${p.capturedAmountInPaise}" ` +
            `for order ${order.orderNumber} — cannot auto-confirm; opening manual-review alert`,
        );
        await this.paymentOps
          .flagMismatch({
            kind: 'ORPHAN_PAYMENT',
            masterOrderId: order.id,
            orderNumber: order.orderNumber,
            providerPaymentId: p.razorpayPaymentId,
            severity: 99,
            description:
              `[orphan-confirm] captured payment ${p.razorpayPaymentId} for order ` +
              `${order.orderNumber} carried a malformed amount ("${p.capturedAmountInPaise}"). ` +
              `Customer may have been charged — manual confirm/refund required.`,
          })
          .catch(() => undefined);
        return;
      }
      const actual = BigInt(p.capturedAmountInPaise);
      const drift = expected > actual ? expected - actual : actual - expected;
      if (drift > 1n) {
        await this.paymentOps
          .flagMismatch({
            kind: 'AMOUNT_MISMATCH',
            masterOrderId: order.id,
            orderNumber: order.orderNumber,
            providerPaymentId: p.razorpayPaymentId,
            expectedInPaise: expected,
            actualInPaise: actual,
            severity: 95,
            description: `[orphan-confirm] amount drift ${drift} paise — auto-confirm withheld.`,
          })
          .catch(() => undefined);
        return;
      }

      const wasPaid = order.paymentStatus === 'PAID';
      const slaMinutes = Math.max(1, Number(process.env.VERIFICATION_SLA_MINUTES ?? 60));
      const verificationDeadlineAt = new Date(Date.now() + slaMinutes * 60 * 1000);

      // Full atomic confirm. Guard ONLY on orderStatus=PENDING_PAYMENT so this
      // also completes a webhook-confirmed order (paymentStatus already PAID but
      // orderStatus stuck PENDING_PAYMENT + razorpayPaymentId NULL). Idempotent:
      // a second orphan event / concurrent verify finds it already PLACED → count 0.
      const flip = await this.prisma.masterOrder.updateMany({
        where: { id: order.id, orderStatus: 'PENDING_PAYMENT' },
        data: {
          orderStatus: 'PLACED',
          paymentStatus: 'PAID',
          razorpayOrderId: p.razorpayOrderId,
          razorpayPaymentId: p.razorpayPaymentId,
          verificationDeadlineAt,
        },
      });
      if (flip.count === 0) {
        this.logger.log(
          `[orphan-confirm] order ${order.orderNumber} already out of PENDING_PAYMENT — idempotent no-op`,
        );
        return;
      }

      await this.prisma.subOrder.updateMany({
        where: { masterOrderId: order.id, acceptStatus: { not: 'REJECTED' } },
        data: { paymentStatus: 'PAID' },
      });

      await this.paymentLifecycle
        .markCaptured({
          providerOrderId: p.razorpayOrderId,
          providerPaymentId: p.razorpayPaymentId,
        })
        .catch(() => undefined);

      // Record the recovery as a POLL_STATUS success in the attempt ledger (#6).
      this.paymentOps
        .recordAttempt({
          masterOrderId: order.id,
          orderNumber: order.orderNumber,
          kind: 'POLL_STATUS',
          status: 'SUCCESS',
          providerOrderId: p.razorpayOrderId,
          providerPaymentId: p.razorpayPaymentId,
          amountInPaise: actual,
          responseSummary: 'orphan-recovery auto-confirmed',
        })
        .catch(() => undefined);

      // Only fan out the captured event if THIS call did the payment confirm
      // (wasPaid=false). If the webhook already flipped paymentStatus=PAID and
      // we only completed orderStatus, the captured event was already emitted —
      // re-emitting would double-fire commission / notification consumers.
      if (!wasPaid) {
        await this.eventBus
          .publish({
            eventName: 'payments.payment.captured',
            aggregate: 'MasterOrder',
            aggregateId: order.id,
            occurredAt: new Date(),
            payload: {
              masterOrderId: order.id,
              orderNumber: order.orderNumber,
              customerId: order.customerId,
              paymentId: p.razorpayPaymentId,
              paymentReference: p.razorpayPaymentId,
              amountInPaise: order.totalAmountInPaise.toString(),
              paymentMethod: order.paymentMethod,
              actorType: 'POLLER',
            },
          })
          .catch(() => undefined);
      }

      await this.audit
        .writeAuditLog({
          actorId: `razorpay:${p.razorpayPaymentId}`,
          actorRole: 'SYSTEM',
          action: 'payments.orphan.confirmed',
          module: 'payments',
          resource: 'master_order',
          resourceId: order.id,
          metadata: {
            orderNumber: order.orderNumber,
            razorpayOrderId: p.razorpayOrderId,
            razorpayPaymentId: p.razorpayPaymentId,
            capturedAmountInPaise: p.capturedAmountInPaise,
            completedWebhookConfirm: wasPaid,
          },
        })
        .catch(() => undefined);

      this.logger.log(
        `[orphan-confirm] order ${order.orderNumber} auto-confirmed PAID from Razorpay ` +
          `payment ${p.razorpayPaymentId}${wasPaid ? ' (completed a webhook-confirmed order)' : ''}`,
      );
    } catch (err) {
      this.logger.error(
        `[orphan-confirm] failed for order ${p.masterOrderId}: ${(err as Error).message}`,
      );
    }
  }
}
