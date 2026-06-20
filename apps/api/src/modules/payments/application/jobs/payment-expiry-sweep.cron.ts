import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 66 (2026-05-22) — payment expiry sweep (audit Gap #18).
 *
 * Pre-Phase-66 a customer who opened the Razorpay modal then walked
 * away left the MasterOrder in PENDING_PAYMENT forever. The 30-min
 * paymentExpiresAt window was stamped but no scheduled task acted
 * on it; the order persisted with stock reserved, blocking other
 * customers from a slot the original buyer had abandoned.
 *
 * This cron runs every 5 minutes, leader-elected so a horizontally-
 * scaled cluster only sweeps once per tick. For each expired row:
 *   1. orderStatus → CANCELLED
 *   2. paymentStatus → EXPIRED (audit Gap #11 enum addition)
 *   3. emit orders.master.payment_expired event so downstream
 *      (StockReservation expiry sweep, notifications) can react.
 *
 * The actual stock reservation release is handled by the existing
 * `ReservationExpirySweepCron` (Phase 4.4) — reservations have their
 * own 15-min TTL that almost always fires before the 30-min payment
 * window. The event we publish here is for observability + future
 * follow-up flows (e.g. send "your order timed out, retry?" email).
 */
@Injectable()
export class PaymentExpirySweepCron {
  private readonly logger = new Logger(PaymentExpirySweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('PAYMENT_EXPIRY_SWEEP_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('payment-expiry-sweep', 10 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(
          `Payment expiry sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  /**
   * Testable inner loop. Returns the count of expired orders so
   * the test harness can assert non-deterministic timing without
   * needing to inspect prisma directly.
   */
  async runOnce(): Promise<{ expired: number }> {
    const now = new Date();
    // Find PENDING_PAYMENT orders past the cutoff. Composite index
    // (orderStatus, paymentExpiresAt) keeps this query cheap even
    // when the table grows to millions of rows.
    const candidates = await this.prisma.masterOrder.findMany({
      where: {
        orderStatus: 'PENDING_PAYMENT',
        paymentExpiresAt: { lt: now, not: null },
      },
      select: { id: true, orderNumber: true, customerId: true },
      take: 500,
    });
    if (candidates.length === 0) return { expired: 0 };

    let expired = 0;
    for (const order of candidates) {
      try {
        // Status-conditional update — if another process (webhook,
        // manual capture, retry) flipped this order between read
        // and write, the WHERE clause fails and we move on.
        const updated = await this.prisma.masterOrder.updateMany({
          where: {
            id: order.id,
            orderStatus: 'PENDING_PAYMENT',
            paymentExpiresAt: { lt: now },
          },
          data: {
            orderStatus: 'CANCELLED',
            paymentStatus: 'EXPIRED',
          },
        });
        if (updated.count === 0) continue;

        expired++;
        // Emit the event the OrderExpiredHandler actually consumes
        // (`payments.payment.expired`) — the previous `orders.master.payment_expired`
        // had NO subscriber, so sweep-cancelled orders got no wallet refund,
        // notification, or audit row. The poller's cancel path already uses
        // this name; both now converge on the same idempotent handler.
        this.eventBus
          .publish({
            eventName: 'payments.payment.expired',
            aggregate: 'MasterOrder',
            aggregateId: order.id,
            occurredAt: new Date(),
            payload: {
              masterOrderId: order.id,
              orderNumber: order.orderNumber,
              customerId: order.customerId,
              reason: 'Payment window expired (expiry sweep)',
            },
          })
          .catch(() => {
            /* best-effort */
          });
      } catch (err) {
        this.logger.warn(
          `Failed to expire payment for order ${order.id}: ${(err as Error).message}`,
        );
      }
    }

    if (expired > 0) {
      this.logger.log(
        `Payment expiry sweep — ${expired} order(s) flipped to CANCELLED/EXPIRED`,
      );
    }
    return { expired };
  }
}
