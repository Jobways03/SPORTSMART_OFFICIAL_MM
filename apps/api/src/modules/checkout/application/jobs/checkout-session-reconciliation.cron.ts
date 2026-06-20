import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';
import { CheckoutService } from '../services/checkout.service';
import { DeferredOrderService } from '../services/deferred-order.service';

/**
 * Option B (Phase 5) — the failure/refund RECONCILER for deferred checkout.
 *
 * Phases 1-4 create the order on capture (sync verify + webhook + recovery
 * cron). This cron closes the loop for the cases that DON'T end in a clean
 * order, in three leader-elected sweeps (ordered by money-urgency):
 *
 *   B. RE-LINK or FAIL stuck PAID-no-order sessions. A materialize that claimed
 *      CREATED→PAID then crashed leaves status=PAID with no masterOrderId. If
 *      the flip actually completed (an order stamped with the gateway order id
 *      is PLACED/PAID — only markOrderCreated failed), RE-LINK it (never refund a
 *      valid paid order). Otherwise mark FAILED → the refund sweep refunds it.
 *      (Any orphan PENDING_PAYMENT order + its wallet debit are cleaned up by
 *      the legacy cancel-expired → OrderExpiredHandler path.)
 *
 *   C. AUTO-REFUND FAILED sessions. The gateway payment WAS captured but the
 *      order couldn't be created → refund session.gatewayAmountInPaise via the
 *      idempotent Razorpay refund, stamp refundedAt+refundReference (CAS). On a
 *      gateway-rejected refund, open an ORPHAN_PAYMENT ops alert and retry next
 *      tick.
 *
 *   A. EXPIRE abandoned sessions (CREATED past expiresAt, never captured). One
 *      FINAL gateway poll first so a late/edge capture isn't stranded (route it
 *      through materializeFromGateway, which materializes or → FAILED→refund);
 *      otherwise CAS-mark EXPIRED. Held stock/discount are released by the
 *      existing 15-min reservation TTL crons.
 *
 * Gated by CHECKOUT_DEFERRED_ORDER_CREATION (no sessions exist otherwise) AND
 * CHECKOUT_SESSION_RECONCILIATION_ENABLED (pausable for incident response). All
 * money operations are idempotent (Razorpay idempotency key + CAS stamps), so a
 * crash and re-run is safe.
 */
const CRON_LOCK = 'checkout-session-reconciliation';

@Injectable()
export class CheckoutSessionReconciliationCron {
  private readonly logger = new Logger(CheckoutSessionReconciliationCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly razorpayAdapter: RazorpayAdapter,
    private readonly checkoutService: CheckoutService,
    private readonly deferredOrderService: DeferredOrderService,
    private readonly paymentOps: PaymentOpsFacade,
  ) {}

  enabled(): boolean {
    return (
      this.env.getBoolean('CHECKOUT_DEFERRED_ORDER_CREATION', false) &&
      this.env.getBoolean('CHECKOUT_SESSION_RECONCILIATION_ENABLED', true)
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run(CRON_LOCK, 10 * 60, async () => {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(
          `Checkout-session reconciliation sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  async tick(): Promise<{
    relinked: number;
    failed: number;
    refunded: number;
    expired: number;
    lateMaterialized: number;
  }> {
    const batch = this.env.getNumber('CHECKOUT_SESSION_RECONCILE_BATCH', 50);
    // B then C so a session marked FAILED by B is refunded in the same tick.
    const { relinked, failed } = await this.reconcileStuckPaid(batch);
    const refunded = await this.refundFailed(batch);
    const { expired, lateMaterialized } = await this.expireAbandoned(batch);

    if (relinked || failed || refunded || expired || lateMaterialized) {
      this.logger.log(
        `[reconcile] relinked=${relinked} failed=${failed} refunded=${refunded} ` +
          `expired=${expired} lateMaterialized=${lateMaterialized}`,
      );
    }
    return { relinked, failed, refunded, expired, lateMaterialized };
  }

  // ── Sweep B — re-link or fail stuck PAID-no-order ───────────────────────
  private async reconcileStuckPaid(
    batch: number,
  ): Promise<{ relinked: number; failed: number }> {
    const graceMinutes = this.env.getNumber(
      'CHECKOUT_SESSION_STUCK_GRACE_MINUTES',
      5,
    );
    // updatedAt lags so we never touch a materialize still in flight (claim flips
    // updatedAt to "now"); only sessions stuck PAID for graceMinutes+ qualify.
    const graceCutoff = new Date(Date.now() - graceMinutes * 60_000);
    const stuck = await this.prisma.checkoutSession.findMany({
      where: {
        status: 'PAID',
        masterOrderId: null,
        updatedAt: { lt: graceCutoff },
      },
      select: { id: true, razorpayOrderId: true, customerId: true },
      take: batch,
    });

    let relinked = 0;
    let failed = 0;
    for (const s of stuck) {
      try {
        // Did the flip actually complete? An order stamped with this gateway
        // order id (scoped to the same customer — MasterOrder.razorpayOrderId is
        // not unique, so customerId is defence against a stray match) that is
        // PAID + not cancelled means only markOrderCreated failed post-commit →
        // re-link; NEVER refund a valid paid order.
        const order = s.razorpayOrderId
          ? await this.prisma.masterOrder.findFirst({
              where: {
                razorpayOrderId: s.razorpayOrderId,
                customerId: s.customerId,
              },
              select: { id: true, orderStatus: true, paymentStatus: true },
            })
          : null;
        if (
          order &&
          order.paymentStatus === 'PAID' &&
          order.orderStatus !== 'CANCELLED' &&
          order.orderStatus !== 'REJECTED'
        ) {
          const { claimed } = await this.deferredOrderService.markOrderCreated(
            s.id,
            order.id,
          );
          if (claimed) {
            relinked++;
            this.logger.log(
              `[reconcile] re-linked stuck session ${s.id} → order ${order.id} ` +
                `(post-commit markOrderCreated had failed).`,
            );
          }
        } else {
          // Claimed PAID then crashed before a completed flip → no valid paid
          // order backs this capture. CAS-fail (guarded on still PAID + no order
          // so a materialize that completed mid-sweep is not clobbered) so sweep
          // C refunds the gateway payment. The orphan PENDING_PAYMENT order (if
          // any) + its wallet debit are reversed by the legacy cancel-expired →
          // OrderExpiredHandler path.
          const { claimed } = await this.deferredOrderService.failStuckPaid(
            s.id,
            'reconciler: PAID with no completed order (materialize crashed)',
          );
          if (claimed) {
            failed++;
            this.logger.warn(
              `[reconcile] stuck session ${s.id} (PAID, no order ${graceMinutes}m+) → FAILED for refund.`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `[reconcile] reconcileStuckPaid failed for ${s.id}: ${(err as Error).message}`,
        );
      }
    }
    return { relinked, failed };
  }

  // ── Sweep C — auto-refund FAILED ────────────────────────────────────────
  private async refundFailed(batch: number): Promise<number> {
    const failed = await this.prisma.checkoutSession.findMany({
      where: {
        status: 'FAILED',
        refundedAt: null,
        razorpayPaymentId: { not: null },
        gatewayAmountInPaise: { gt: 0 },
      },
      select: {
        id: true,
        razorpayPaymentId: true,
        gatewayAmountInPaise: true,
      },
      take: batch,
    });

    let refunded = 0;
    for (const s of failed) {
      if (!s.razorpayPaymentId) continue;
      try {
        // Re-fetch the payment so we refund the ACTUAL captured amount (not the
        // stale requested gatewayAmountInPaise) — guards against a partial/over
        // capture, and lets us skip a payment that isn't actually captured (or
        // was already refunded out-of-band).
        const gw = await this.razorpayAdapter.getRawPayment(s.razorpayPaymentId);
        if (gw.status === 'refunded') {
          // Already refunded at the gateway (e.g. a manual refund) — close the
          // session so we stop retrying. No new refund issued.
          await this.deferredOrderService.markRefunded(s.id, null);
          continue;
        }
        if (gw.status !== 'captured') {
          // Not captured (failed/authorized/etc.) — nothing to refund; the
          // payment never took the customer's money. Log + skip (no retry churn
          // needed; it won't become captured later for a FAILED session).
          this.logger.warn(
            `[reconcile] session ${s.id} payment ${s.razorpayPaymentId} ` +
              `status=${gw.status}; not refunding.`,
          );
          continue;
        }
        const amount = BigInt(gw.amount);
        const result = await this.razorpayAdapter.initiateRefund(
          s.razorpayPaymentId,
          amount,
          { checkout_session_id: s.id, source: 'phase5_reconciler' },
          { idempotencyKey: `checkout-refund-${s.id}` },
        );
        if (result.status === 'failed') {
          await this.alertRefundFailure(
            s.id,
            s.razorpayPaymentId,
            amount,
            `gateway returned status=failed (refund ${result.providerRefundId})`,
          );
          continue;
        }
        // processed | pending — accepted by the gateway; stamp idempotently.
        const { claimed } = await this.deferredOrderService.markRefunded(
          s.id,
          result.providerRefundId,
        );
        if (claimed) {
          refunded++;
          this.logger.log(
            `[reconcile] refunded FAILED session ${s.id}: ${result.providerRefundId} ` +
              `(${result.status}), ${amount.toString()} paise.`,
          );
        }
      } catch (err) {
        // Fetch/refund threw — alert with the expected amount (the actual
        // captured amount may be unknown if getRawPayment itself failed).
        await this.alertRefundFailure(
          s.id,
          s.razorpayPaymentId,
          BigInt(s.gatewayAmountInPaise),
          (err as Error).message,
        );
      }
    }
    return refunded;
  }

  private async alertRefundFailure(
    sessionId: string,
    providerPaymentId: string,
    amount: bigint,
    reason: string,
  ): Promise<void> {
    this.logger.error(
      `[reconcile] auto-refund FAILED for session ${sessionId} ` +
        `(payment ${providerPaymentId}): ${reason}`,
    );
    await this.paymentOps
      .flagMismatch({
        kind: 'ORPHAN_PAYMENT',
        masterOrderId: null,
        orderNumber: null,
        providerPaymentId,
        expectedInPaise: amount,
        severity: 95,
        description:
          `Deferred-checkout auto-refund failed for session ${sessionId}: ${reason}. ` +
          `Captured payment ${providerPaymentId} (${amount.toString()} paise) needs a manual refund.`,
        sourceType: 'RECONCILIATION',
        sourceContext: { sessionId },
      })
      .catch((alertErr) =>
        this.logger.error(
          `[reconcile] failed to open refund-failure alert for ${sessionId}: ${(alertErr as Error).message}`,
        ),
      );
  }

  // ── Sweep A — expire abandoned (with a final capture check) ─────────────
  private async expireAbandoned(
    batch: number,
  ): Promise<{ expired: number; lateMaterialized: number }> {
    const abandoned = await this.prisma.checkoutSession.findMany({
      where: { status: 'CREATED', expiresAt: { lt: new Date() } },
      select: { id: true, razorpayOrderId: true },
      take: batch,
    });

    let expired = 0;
    let lateMaterialized = 0;
    for (const s of abandoned) {
      try {
        // One FINAL capture check before closing — a payment captured near the
        // window edge (or a delayed webhook) must not be stranded. Route any
        // capture through materializeFromGateway (materializes, or → FAILED →
        // refund). If it materialized/failed, the session left CREATED so the
        // CAS markExpired below no-ops.
        if (s.razorpayOrderId) {
          const payments = await this.razorpayAdapter.fetchOrderPayments(
            s.razorpayOrderId,
          );
          const captured = payments
            .filter((p) => p.captured && p.status === 'captured')
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
          if (captured) {
            await this.checkoutService.materializeFromGateway(
              s.razorpayOrderId,
              captured.paymentId,
            );
            lateMaterialized++;
            continue;
          }
        }
        // No capture — close the lifecycle. CAS on status='CREATED' so a
        // concurrent materialize (now PAID) is never clobbered. Held stock +
        // discount are released by the existing 15-min reservation TTL crons.
        const { claimed } = await this.deferredOrderService.markExpired(s.id);
        if (claimed) expired++;
      } catch (err) {
        this.logger.warn(
          `[reconcile] expireAbandoned failed for ${s.id}: ${(err as Error).message}`,
        );
      }
    }
    return { expired, lateMaterialized };
  }
}
