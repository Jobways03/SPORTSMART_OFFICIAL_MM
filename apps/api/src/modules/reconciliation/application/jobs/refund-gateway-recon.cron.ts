import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { RefundInstructionService } from '../../../refund-instructions/application/services/refund-instruction.service';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';

/**
 * Phase 3 (PR 3.5) — Refund-gateway reconciliation cron.
 * Phase 167 (Refund Execution audit #1/#4/#9/#10) — made REAL.
 *
 * Every Razorpay refund creates a `RefundInstruction` in PROCESSING with a
 * `gatewayRefundId`. The webhook is the fast path; this cron is the safety
 * net that reconciles against the gateway GET for refunds whose webhook
 * never landed.
 *
 * For each PROCESSING instruction with `gatewayRefundId` (respecting a
 * per-row poll backoff):
 *   - Resolve the razorpay_payment_id via the order, hit Razorpay's
 *     GET /payments/{p}/refunds/{r} (RazorpayAdapter.getRefundStatus).
 *   - gateway `processed` → instruction SUCCESS; `failed` → FAILED (both CAS).
 *   - still pending past STUCK_AFTER_HOURS → emit `refund.gateway.stuck`
 *     (consumed by RefundGatewayStuckHandler → ops alert).
 *
 * Pre-Phase-167 this was a SCHEDULING stub (setInterval + unfenced Redis lock)
 * that only emitted the stuck event into a vacuum. It is now @Cron +
 * LeaderElectedCron (fenced) + CronInstrumentation, and actually calls the gateway.
 */
@Injectable()
export class RefundGatewayReconCron {
  private readonly logger = new Logger(RefundGatewayReconCron.name);
  private static readonly STUCK_AFTER_HOURS = 24;
  // Phase 167 (#16) — consecutive gateway fetch failures across ticks → alert.
  private consecutiveFetchFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly events: EventBusService,
    private readonly razorpayAdapter: RazorpayAdapter,
    private readonly instructionService: RefundInstructionService,
    private readonly paymentOps: PaymentOpsFacade,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  private enabled(): boolean {
    return this.env.getBoolean('REFUND_GATEWAY_RECON_ENABLED', true);
  }

  // Phase 167 (#9) — @Cron + LeaderElectedCron + CronInstrumentation (was setInterval).
  @Cron(CronExpression.EVERY_30_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('refund-gateway-recon', 10 * 60, async () => {
      try {
        await this.instr.wrap('reconciliation.refund_gateway', () => this.tick());
      } catch {
        // recorded as FAILED in cron_runs
      }
    });
  }

  async tick(): Promise<{ checked: number; settled: number; failed: number; stuck: number }> {
    const backoffMinutes = this.env.getNumber('REFUND_GATEWAY_RECON_BACKOFF_MINUTES', 30);
    const backoffCutoff = new Date(Date.now() - backoffMinutes * 60_000);
    const stuckCutoff = new Date(
      Date.now() - RefundGatewayReconCron.STUCK_AFTER_HOURS * 3_600_000,
    );

    const candidates = await this.prisma.refundInstruction.findMany({
      where: {
        status: 'PROCESSING',
        gatewayRefundId: { not: null },
        OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: backoffCutoff } }],
      },
      select: {
        id: true,
        customerId: true,
        orderId: true,
        gatewayRefundId: true,
        // Stuck-detection MUST use createdAt (immutable), NOT updatedAt — the
        // per-tick lastPolledAt stamp below bumps @updatedAt, which would reset
        // an updatedAt-based 24h check so it could never fire.
        createdAt: true,
      },
      take: this.env.getNumber('REFUND_GATEWAY_RECON_BATCH', 50),
    });

    let settled = 0;
    let failed = 0;
    let stuck = 0;
    for (const inst of candidates) {
      let pollError: string | null = null;
      let stillPending = true;
      // Phase 167 review (L1#2) — emit the `stuck` signal ONLY when we actually
      // reached the gateway and it returned a non-terminal status. An instruction
      // we could not even poll (no resolvable payment id) is an orphan/data issue,
      // not a gateway-stuck refund — emitting `refund.gateway.stuck` (sev-95
      // ORPHAN_PAYMENT) for it would be a false positive on order-less dispute
      // refunds. Those rows surface via last_poll_error instead.
      let reachedGatewayPending = false;
      try {
        const paymentId = inst.orderId
          ? await this.resolvePaymentId(inst.orderId)
          : null;
        if (!paymentId) {
          pollError = 'no razorpay_payment_id resolvable for this instruction';
          this.logger.warn(
            `[refund-recon] instruction ${inst.id} has gatewayRefundId ` +
              `${inst.gatewayRefundId} but no resolvable razorpay_payment_id ` +
              `(orderId=${inst.orderId ?? 'null'}) — cannot reconcile; see last_poll_error`,
          );
        } else if (inst.gatewayRefundId) {
          const gw = await this.razorpayAdapter.getRefundStatus(
            paymentId,
            inst.gatewayRefundId,
          );
          this.consecutiveFetchFailures = 0;
          const s = String(gw.status).toLowerCase();
          if (s === 'processed') {
            const { flipped } = await this.instructionService.markGatewayOutcome({
              instructionId: inst.id,
              outcome: 'SUCCESS',
            });
            if (flipped) settled++;
            stillPending = false;
            this.logger.log(
              `[refund-recon] instruction ${inst.id} reconciled SUCCESS (gateway processed)`,
            );
          } else if (s === 'failed') {
            const { flipped } = await this.instructionService.markGatewayOutcome({
              instructionId: inst.id,
              outcome: 'FAILED',
              failureReason: 'Gateway reconciliation: refund failed',
            });
            if (flipped) failed++;
            stillPending = false;
            this.logger.warn(
              `[refund-recon] instruction ${inst.id} reconciled FAILED (gateway failed)`,
            );
          } else {
            // Still pending AT THE GATEWAY — leave PROCESSING. This is the only
            // state that can legitimately become "stuck" past the window.
            reachedGatewayPending = true;
          }
        }
      } catch (err) {
        pollError = (err as Error).message;
        await this.onFetchFailure(inst, err as Error);
      }

      // Phase 167 (#8) — stamp poll tracking so the backoff applies + ops can
      // see when/how-often/with-what-error we reconciled.
      // Phase 167 review (L1#3) — only stamp while STILL PENDING. If we flipped
      // the row terminal this tick (or the webhook beat us to it), it's no longer
      // a PROCESSING candidate, so re-stamping poll metadata on it is a spurious
      // write to a settled row.
      if (stillPending) {
        await this.prisma.refundInstruction
          .update({
            where: { id: inst.id },
            data: {
              lastPolledAt: new Date(),
              pollAttemptCount: { increment: 1 },
              lastPollError: pollError,
            },
          })
          .catch(() => undefined);
      }

      // Phase 167 (#10) — genuinely-stuck: gateway STILL says pending past the
      // window. Emit only now (not for everything, and not for rows we couldn't
      // poll) so the consumer's alert means "the gateway can't tell us + it's
      // been a day".
      if (reachedGatewayPending && inst.createdAt < stuckCutoff) {
        this.events
          .publish({
            eventName: 'refund.gateway.stuck',
            aggregate: 'RefundInstruction',
            aggregateId: inst.id,
            occurredAt: new Date(),
            payload: {
              instructionId: inst.id,
              customerId: inst.customerId,
              gatewayRefundId: inst.gatewayRefundId,
              stuckSinceMs: Date.now() - inst.createdAt.getTime(),
            },
          })
          .catch(() => undefined);
        stuck++;
      }
    }

    this.logger.log(
      `refund-gateway recon: checked=${candidates.length} settled=${settled} failed=${failed} stuck=${stuck}`,
    );
    return { checked: candidates.length, settled, failed, stuck };
  }

  /** Resolve the razorpay_payment_id for an instruction via its order. */
  private async resolvePaymentId(orderId: string): Promise<string | null> {
    const order = await this.prisma.masterOrder
      .findUnique({
        where: { id: orderId },
        select: { razorpayPaymentId: true },
      })
      .catch(() => null);
    return order?.razorpayPaymentId ?? null;
  }

  /**
   * Phase 167 (#16) — after N consecutive gateway fetch failures, open an
   * alert (revoked/expired credentials would otherwise fail silently).
   */
  private async onFetchFailure(
    inst: { id: string; customerId: string },
    err: Error,
  ): Promise<void> {
    this.consecutiveFetchFailures++;
    this.logger.warn(
      `[refund-recon] gateway fetch failed for instruction ${inst.id} ` +
        `(consecutive=${this.consecutiveFetchFailures}): ${err.message}`,
    );
    const threshold = this.env.getNumber(
      'REFUND_GATEWAY_RECON_FAILURE_ALERT_THRESHOLD',
      5,
    );
    if (this.consecutiveFetchFailures >= threshold) {
      await this.paymentOps
        .flagMismatch({
          kind: 'ORPHAN_PAYMENT',
          masterOrderId: null,
          severity: 95,
          description:
            `[refund-recon] ${this.consecutiveFetchFailures} consecutive Razorpay ` +
            `refund-status fetch failures (last: ${err.message}). Refund reconciliation ` +
            `is effectively down — check gateway credentials / connectivity.`,
          sourceType: 'RECONCILIATION', // Phase 169 (#13)
        })
        .catch(() => undefined);
      this.consecutiveFetchFailures = 0;
    }
  }
}
