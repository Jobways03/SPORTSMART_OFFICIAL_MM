import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { ReturnService } from './return.service';
import { RefundGatewayService } from './refund-gateway.service';

const LOCK_KEY = 'lock:refund-processor';
const LOCK_TTL = 60;

/**
 * Background processor that handles two related jobs:
 *
 * 1. **Refund polling**: returns in REFUND_PROCESSING that already have a
 *    refundReference (gateway call succeeded, confirmation pending) are polled
 *    against Razorpay. When the gateway reports `processed`, we auto-confirm.
 *
 * 2. **Refund retry**: returns in REFUND_PROCESSING that have NO refund
 *    reference (gateway call failed on first attempt) and whose last attempt
 *    was > REFUND_RETRY_BACKOFF_MINUTES ago are auto-retried up to the 5-attempt
 *    cap already enforced by ReturnService.retryRefund().
 *
 * Both run under one Redis lock so multiple API instances don't race.
 */
// Phase 101 (2026-05-23) — Refund Retry audit Gap #9 / #10 / #11
// closure.
//
// Pre-Phase-101 this service used OnModuleInit + setInterval to drive
// the polling + retry loop. Other crons in the codebase use
// @nestjs/schedule's @Cron + LeaderElectedCron + CronInstrumentation,
// so observability dashboards (cron_runs row per tick, processed
// counts) only covered them. We now migrate for parity.
//
// REFUND_POLL_INTERVAL_SECONDS still controls how often we tick. The
// @Cron expression below is computed at init time. setInterval ≤ 0
// silent-disable is replaced by an explicit env guard that logs a
// loud warning at module init AND on every would-be tick so a
// misconfiguration never goes unnoticed (Phase 101 #22).
@Injectable()
export class RefundProcessorService {
  private readonly logger = new Logger(RefundProcessorService.name);
  private readonly retryBackoffMs: number;
  private readonly intervalSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
    private readonly returnService: ReturnService,
    private readonly refundGateway: RefundGatewayService,
    private readonly leader: LeaderElectedCron,
    private readonly instrumentation: CronInstrumentationService,
  ) {
    this.intervalSec = this.envService.getNumber(
      'REFUND_POLL_INTERVAL_SECONDS',
      120,
    );
    this.retryBackoffMs =
      this.envService.getNumber('REFUND_RETRY_BACKOFF_MINUTES', 15) *
      60_000;
    if (this.intervalSec <= 0) {
      this.logger.warn(
        `Refund processor DISABLED (REFUND_POLL_INTERVAL_SECONDS=${this.intervalSec}). ` +
          'Refunds in REFUND_PROCESSING will NOT auto-confirm or retry. ' +
          'Flip the env to a positive value in staging+prod.',
      );
    }
  }

  enabled(): boolean {
    return this.intervalSec > 0;
  }

  // Phase 101 — Gap #11 closure. LeaderElectedCron mirrors other
  // crons (stuck-saga sweep, seller-response sweeper). Redis SET NX
  // EX inside LeaderElectedCron is more robust than the old per-tick
  // Redis lock since the leadership lease is renewed automatically.
  //
  // Phase 106 (2026-05-23) — Phase 101 audit Gap #2 closure. The
  // cron-tick cadence (2 min) is intentionally tighter than the
  // per-return retry backoff (15 min, env REFUND_RETRY_BACKOFF_MINUTES).
  // The two serve different jobs:
  //
  //   • Polling — checks Razorpay for inflight refund status. NO
  //     per-row backoff; we want the freshest status. Hence 2 min.
  //
  //   • Retry — re-issues failed gateway calls. Per-row backoff is
  //     15 min so we don't spam Razorpay during transient outages.
  //     A return that hit its 15-min boundary 14 min ago will pick
  //     up on the next tick (≤2 min later).
  //
  // Net: customer-visible retry cadence is ~15 min ± 2 min jitter,
  // which is what the spec asks for. The "wasted" 13 cron ticks per
  // retry are cheap (each is just a SELECT) and they earn us
  // sub-2-min poll latency for refunds that gateway settles fast.
  @Cron('*/2 * * * *') // poll every 2 min; retry inherits this cadence + per-row 15-min backoff
  async run(): Promise<void> {
    if (!this.enabled()) {
      this.logger.warn(
        '[refund-processor] Refund processor disabled by env; tick skipped',
      );
      return;
    }
    await this.leader.run(
      'refund-processor',
      Math.max(LOCK_TTL, this.intervalSec * 2),
      async () => {
        await this.instrumentation.wrap(
          'returns.refund_processor',
          async () => {
            // Phase 101 — Gap #9 partial closure. Poll + retry still
            // share one leader lease so two replicas don't both
            // process the same row. Inside the lease we still run them
            // sequentially so a slow poll doesn't starve retry.
            await this.pollPendingRefunds();
            await this.retryFailedRefunds();
            return { ok: true };
          },
        );
      },
    );
  }

  /** Legacy entrypoint retained for tests + manual ticking. */
  async tick(): Promise<void> {
    if (!this.enabled()) return;
    const lockAcquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!lockAcquired) return;
    try {
      await this.pollPendingRefunds();
      await this.retryFailedRefunds();
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }

  /**
   * Poll Razorpay for returns that have a gateway refund ID but haven't
   * been confirmed yet. When gateway says "processed", auto-confirm.
   */
  private async pollPendingRefunds(): Promise<void> {
    const pending = await this.prisma.return.findMany({
      where: {
        status: 'REFUND_PROCESSING',
        refundReference: { not: null },
      },
      select: {
        id: true,
        returnNumber: true,
        refundReference: true,
      },
      take: 30,
    });

    for (const ret of pending) {
      if (!ret.refundReference) continue;
      try {
        const gatewayStatus = await this.refundGateway.checkRefundStatus(
          ret.id,
          ret.refundReference,
        );
        if (gatewayStatus.status === 'PROCESSED') {
          // Mark the audit row as PROCESSED before confirming
          await this.prisma.refundTransaction.updateMany({
            where: {
              returnId: ret.id,
              gatewayRefundId: ret.refundReference,
              status: 'INITIATED',
            },
            data: { status: 'PROCESSED' },
          });
          await this.returnService.confirmRefund(
            ret.id,
            'SYSTEM',
            'refund-processor',
            {
              refundReference: ret.refundReference,
              notes: 'Auto-confirmed by refund poller',
            },
          );
          this.logger.log(
            `Auto-confirmed refund for ${ret.returnNumber} (ref=${ret.refundReference})`,
          );
        } else if (gatewayStatus.status === 'FAILED') {
          await this.returnService.markRefundFailed(
            ret.id,
            'SYSTEM',
            'refund-processor',
            gatewayStatus.failureReason || 'Gateway reported failure',
          );
          this.logger.warn(
            `Refund failed at gateway for ${ret.returnNumber}: ${gatewayStatus.failureReason}`,
          );
        }
        // PENDING → do nothing, check again next tick
      } catch (err) {
        this.logger.error(
          `Failed to poll refund for ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Retry refund gateway calls for returns that failed previously.
   * Only retries if last attempt was > backoff minutes ago, and only up to
   * the 5-attempt cap enforced by ReturnService.retryRefund().
   */
  private async retryFailedRefunds(): Promise<void> {
    const backoffCutoff = new Date(Date.now() - this.retryBackoffMs);

    // Phase 101 (2026-05-23) — Refund Retry audit Gap #6/#7 closure.
    // Pre-Phase-101 the cap (5) was hardcoded in the query AND in the
    // service constant. We now read the env so the two stay in sync;
    // the per-return refundMaxRetries column (when set) overrides the
    // env default but the cron-side query uses the env value as a
    // ceiling — per-row tighter caps are still enforced in
    // ReturnService.retryRefund.
    const maxAttempts =
      this.envService?.getNumber?.('REFUND_MAX_RETRY_ATTEMPTS' as any, 5) ?? 5;
    const retriable = await this.prisma.return.findMany({
      where: {
        status: 'REFUND_PROCESSING' as any,
        refundReference: null,
        refundAttempts: { lt: maxAttempts },
        OR: [
          { refundLastAttemptAt: null },
          { refundLastAttemptAt: { lt: backoffCutoff } },
        ],
      },
      select: { id: true, returnNumber: true, refundAttempts: true },
      take: 20,
    });

    for (const ret of retriable) {
      try {
        // Phase 105 (2026-05-23) — Phase 101 audit Gap #29 closure.
        // If a linked RefundInstruction exists in a state that
        // doesn't want auto-retry (MANUAL_REQUIRED waiting on ops,
        // CANCELLED, or in-flight PROCESSING through the saga),
        // skip the cron retry so we don't fight the instruction-side
        // flow.
        const instruction = await this.prisma.refundInstruction.findFirst({
          where: {
            sourceType: 'RETURN' as any,
            sourceId: ret.id,
          },
          select: { status: true },
        });
        if (instruction) {
          const skip = ['MANUAL_REQUIRED', 'CANCELLED', 'PROCESSING'];
          if (skip.includes(String(instruction.status))) {
            this.logger.log(
              `[refund-retry-cron] skipped ${ret.returnNumber}: linked instruction is ${instruction.status}`,
            );
            continue;
          }
        }
        await this.returnService.retryRefund(
          ret.id,
          'SYSTEM',
          'refund-processor',
        );
        this.logger.log(
          `Auto-retried refund for ${ret.returnNumber} (attempt ${(ret.refundAttempts ?? 0) + 1})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to auto-retry refund for ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
  }
}
