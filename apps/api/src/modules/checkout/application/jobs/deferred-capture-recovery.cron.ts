import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { CheckoutService } from '../services/checkout.service';

/**
 * Option B (Phase 4) — backstop for the Razorpay webhook.
 *
 * The webhook (payment.captured → `payments.gateway_capture_unresolved` →
 * GatewayCaptureUnresolvedHandler) is the PRIMARY path that materializes a
 * deferred order when the customer pays but never returns to the verify
 * endpoint (closed tab). This cron covers the cases the webhook can't: a missed
 * delivery, a disabled webhook (local dev), or a Razorpay outage. It mirrors the
 * legacy PaymentStatusPollerService.confirmOrphanedPayments, but scans
 * CheckoutSessions (the deferred world) instead of MasterOrders.
 *
 * It scans CREATED sessions that have a gateway order but no materialized order
 * and are still inside the payment window, polls Razorpay for a captured
 * payment, and routes any capture through CheckoutService.materializeFromGateway
 * (which owns the exactly-once CAS + gateway-amount assertion). A PAID session
 * with no order (a crashed materialize) is the Phase-5 reconciler's job, not
 * this cron's. lastPolledAt provides per-session backoff so an abandoned-but-
 * paid session isn't polled every minute across the whole window.
 *
 * Leader-elected (cluster-safe) + gated behind CHECKOUT_DEFERRED_ORDER_CREATION.
 */
const CRON_LOCK = 'deferred-capture-recovery';

@Injectable()
export class DeferredCaptureRecoveryCron {
  private readonly logger = new Logger(DeferredCaptureRecoveryCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly razorpayAdapter: RazorpayAdapter,
    private readonly checkoutService: CheckoutService,
  ) {}

  enabled(): boolean {
    return (
      this.env.getBoolean('CHECKOUT_DEFERRED_ORDER_CREATION', false) &&
      this.env.getNumber('PAYMENT_POLL_INTERVAL_SECONDS', 60) > 0
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run(CRON_LOCK, 5 * 60, async () => {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(
          `Deferred-capture recovery sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  async tick(): Promise<{ scanned: number; materialized: number }> {
    const backoffSeconds = this.env.getNumber(
      'DEFERRED_CAPTURE_BACKOFF_SECONDS',
      180,
    );
    const backoffCutoff = new Date(Date.now() - backoffSeconds * 1000);

    // CREATED + gateway order minted + not yet materialized + still in-window.
    // (PAID-but-no-order is a crashed materialize → Phase-5 reconciler.)
    const candidates = await this.prisma.checkoutSession.findMany({
      where: {
        status: 'CREATED',
        razorpayOrderId: { not: null },
        masterOrderId: null,
        expiresAt: { gte: new Date() },
        OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: backoffCutoff } }],
      },
      select: { id: true, razorpayOrderId: true },
      take: this.env.getNumber('DEFERRED_CAPTURE_BATCH', 20),
    });

    let materialized = 0;
    for (const s of candidates) {
      if (!s.razorpayOrderId) continue;
      try {
        const payments = await this.razorpayAdapter.fetchOrderPayments(
          s.razorpayOrderId,
        );
        // Pick the LATEST captured payment (Razorpay can have several attempts
        // per order; an old one could be stale). Mirrors the legacy poller.
        const captured = payments
          .filter((p) => p.captured && p.status === 'captured')
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        if (captured) {
          const res = await this.checkoutService.materializeFromGateway(
            s.razorpayOrderId,
            captured.paymentId,
          );
          if (res) {
            materialized++;
            this.logger.log(
              `[deferred-capture] materialized order ${res.orderNumber} from ` +
                `session ${s.id} (gateway order ${s.razorpayOrderId}, payment ${captured.paymentId}).`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `[deferred-capture] poll failed for session ${s.id}: ${(err as Error).message}`,
        );
      } finally {
        // Stamp the backoff timestamp regardless of outcome so a transient
        // gateway failure doesn't re-poll this session every tick.
        await this.prisma.checkoutSession
          .update({ where: { id: s.id }, data: { lastPolledAt: new Date() } })
          .catch(() => undefined);
      }
    }

    if (materialized > 0) {
      this.logger.log(
        `[deferred-capture] scanned=${candidates.length} materialized=${materialized}`,
      );
    }
    return { scanned: candidates.length, materialized };
  }
}
