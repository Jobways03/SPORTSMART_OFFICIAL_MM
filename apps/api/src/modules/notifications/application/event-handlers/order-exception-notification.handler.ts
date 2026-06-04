import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailService } from '../../../../integrations/email/email.service';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';
import { safeHtml } from '../../../../core/util/escape-html';

/**
 * Allocation-Exception-Queue audit (#234) — the `orders.master.exception` event
 * (published by orders.service / franchise-orders.service when a verified order
 * can't be routed to any fulfillment node and is parked in EXCEPTION_QUEUE) had
 * ZERO consumers. So the order would sit silently: the customer heard nothing,
 * and ops had no signal beyond manually scanning `orderStatus=EXCEPTION_QUEUE`.
 *
 * This handler closes both loops:
 *   (a) CUSTOMER — a calm, non-alarming "your order is being reviewed and will
 *       be confirmed shortly" email (we deliberately do NOT expose the internal
 *       exceptionReason / detail to the customer — that's an ops concern).
 *   (b) ADMIN/OPS — an AdminTask (the canonical ops queue, via
 *       LiabilityLedgerPublicFacade.enqueueAdminTask) keyed to the order so it
 *       shows up in the ops backlog with an SLA, deduped per order.
 *
 * Best-effort + idempotent: customer-email and admin-task run in independent
 * try/catch blocks (one failing must not skip the other), nothing throws back
 * into the publisher (the publish sites are themselves best-effort), and
 * @IdempotentHandler guards against outbox-replay double-fire. The AdminTask is
 * additionally deduped on (kind, sourceType, sourceId) by the facade.
 *
 * Payload note: only the verify→no-route publisher (orders.service) sets the
 * structured `exceptionReason`; the seller/franchise rejection publishers send
 * only the human `reason`. Both are handled — `exceptionReason` is optional and
 * the mapping falls back to a generic title/SLA when it's absent/UNKNOWN.
 */

type ExceptionReasonCode =
  | 'NO_PINCODE_ON_ORDER'
  | 'PINCODE_UNSERVICEABLE'
  | 'NO_STOCK_AVAILABLE'
  | 'NO_NODE_MAPPED'
  | 'SELLER_REJECTED'
  | 'NODE_SUSPENDED'
  | 'UNKNOWN';

interface OrderExceptionPayload {
  masterOrderId: string;
  orderNumber: string;
  customerId?: string;
  orderStatus?: string;
  // Only the verify→no-route publisher sets this (enum string | null). The
  // seller/franchise rejection publishers omit it.
  exceptionReason?: ExceptionReasonCode | null;
  // Always present — human-readable detail.
  reason?: string | null;
}

/**
 * exceptionReason → ops task title + SLA hours. A stuck *paid* customer order is
 * time-sensitive, so the default SLA is tight (24h). Data-quality causes the
 * customer can't fix themselves (no/bad pincode) get a slightly longer lane.
 */
const REASON_META: Record<
  ExceptionReasonCode,
  { title: string; slaHours: number }
> = {
  NO_PINCODE_ON_ORDER: {
    title: 'Order has no delivery pincode — cannot allocate',
    slaHours: 48,
  },
  PINCODE_UNSERVICEABLE: {
    title: 'Delivery pincode is not serviceable by any node',
    slaHours: 48,
  },
  NO_STOCK_AVAILABLE: {
    title: 'No fulfillment node has stock for this order',
    slaHours: 24,
  },
  NO_NODE_MAPPED: {
    title: 'No fulfillment node mapped for this order',
    slaHours: 24,
  },
  SELLER_REJECTED: {
    title: 'Seller rejected and no alternative node — needs reassignment',
    slaHours: 24,
  },
  NODE_SUSPENDED: {
    title: 'Allocated node is suspended — order needs reassignment',
    slaHours: 24,
  },
  UNKNOWN: {
    title: 'Order parked in exception queue — needs manual allocation',
    slaHours: 24,
  },
};

@Injectable()
export class OrderExceptionNotificationHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly ledger: LiabilityLedgerPublicFacade,
    private readonly logger: AppLoggerService,
    // Outbox-replay dedup, consumed by @IdempotentHandler. Gracefully no-ops in
    // unit tests that construct the handler without DI (see sibling handlers).
    protected readonly eventDedup: EventDeduplicationService,
  ) {
    this.logger.setContext('OrderExceptionNotificationHandler');
  }

  @OnEvent('orders.master.exception')
  @IdempotentHandler()
  async onOrderException(
    event: DomainEvent<OrderExceptionPayload>,
  ): Promise<void> {
    const p = event.payload;
    if (!p?.masterOrderId) return;

    // (a) Customer reassurance email — independent best-effort.
    await this.notifyCustomer(p);

    // (b) Ops AdminTask — independent best-effort.
    await this.raiseAdminTask(p);
  }

  private async notifyCustomer(p: OrderExceptionPayload): Promise<void> {
    try {
      const order = await this.prisma.masterOrder.findUnique({
        where: { id: p.masterOrderId },
        include: {
          customer: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      });
      if (!order?.customer?.email) return;
      const name =
        `${order.customer.firstName ?? ''} ${order.customer.lastName ?? ''}`.trim();

      // Deliberately non-alarming and free of the internal exceptionReason /
      // detail — the customer only needs to know we're on it.
      const content = safeHtml`
        <h3 style="color: #2563eb; margin-top: 0;">We're reviewing your order</h3>
        <p>Hi ${name || 'there'},</p>
        <p>Thanks for your order <strong>${p.orderNumber}</strong>. We're carrying out a quick review to make sure everything is in order before we confirm it.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;">There's nothing you need to do right now — we'll email you again as soon as it's confirmed, usually within a short while.</p>
        </div>
        <p>If you have any questions in the meantime, our support team is happy to help.</p>
      `;

      await this.emailService.send({
        to: order.customer.email,
        subject: `We're reviewing your order ${p.orderNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send orders.master.exception customer email for ${p.masterOrderId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  private async raiseAdminTask(p: OrderExceptionPayload): Promise<void> {
    try {
      const code: ExceptionReasonCode = p.exceptionReason ?? 'UNKNOWN';
      const meta = REASON_META[code] ?? REASON_META.UNKNOWN;
      const detail = (p.reason ?? '').trim();

      const reason =
        `Order ${p.orderNumber} entered EXCEPTION_QUEUE: ${meta.title}` +
        ` (${code}).` +
        (detail ? ` Detail: ${detail}` : '') +
        ` Manual allocation / reassignment required.`;

      // Canonical ops queue. Keyed like COD/chargeback (no first-class order
      // LedgerSourceType): sourceType=MANUAL, sourceId=masterOrderId. The facade
      // dedups on (kind, sourceType, sourceId), so a replay or a second
      // exception transition for the same order won't pile up duplicate tasks.
      await this.ledger.enqueueAdminTask({
        kind: 'ORDER_ALLOCATION_EXCEPTION',
        sourceType: 'MANUAL',
        sourceId: p.masterOrderId,
        reason,
        slaHours: meta.slaHours,
      });
    } catch (err) {
      this.logger.error(
        `Failed to enqueue ORDER_ALLOCATION_EXCEPTION admin task for ${p.masterOrderId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Shared SPORTSMART email shell. `content` MUST already be HTML-safe — the
   * caller builds it via `safeHtml`. The static shell has no interpolation.
   * (Mirrors OrderNotificationHandler.wrapTemplate.)
   */
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
}
