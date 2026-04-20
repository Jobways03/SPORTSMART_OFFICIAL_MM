import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
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
@Injectable()
export class RefundProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RefundProcessorService.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly retryBackoffMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
    private readonly returnService: ReturnService,
    private readonly refundGateway: RefundGatewayService,
  ) {
    this.intervalMs =
      this.envService.getNumber('REFUND_POLL_INTERVAL_SECONDS', 120) * 1000;
    this.retryBackoffMs =
      this.envService.getNumber('REFUND_RETRY_BACKOFF_MINUTES', 15) *
      60_000;
  }

  onModuleInit() {
    if (this.intervalMs <= 0) {
      this.logger.log('Refund processor disabled');
      return;
    }
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `Refund processor tick crashed: ${(err as Error).message}`,
        ),
      );
    }, this.intervalMs);
    this.logger.log(
      `Refund processor started (poll every ${this.intervalMs / 1000}s, retry backoff ${this.retryBackoffMs / 60_000}min)`,
    );
  }

  onModuleDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  async tick(): Promise<void> {
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

    const retriable = await this.prisma.return.findMany({
      where: {
        status: 'REFUND_PROCESSING',
        refundReference: null,
        refundAttempts: { lt: 5 },
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
