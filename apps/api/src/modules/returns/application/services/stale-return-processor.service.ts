import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

const LOCK_KEY = 'lock:stale-return-processor';
const LOCK_TTL = 120;

/**
 * Background processor that handles returns stuck in intermediate states.
 *
 * | Stuck status          | Action                                         |
 * |-----------------------|------------------------------------------------|
 * | REQUESTED             | Auto-cancel (customer never followed up)        |
 * | APPROVED              | Auto-cancel (pickup never happened)             |
 * | PICKUP_SCHEDULED      | Escalate to admin (courier issue likely)        |
 * | IN_TRANSIT            | Escalate to admin (lost in transit?)            |
 * | RECEIVED              | Escalate to admin (QC never done)               |
 * | REFUND_PROCESSING     | Leave for RefundProcessor; only escalate if     |
 * |                       | attempts exhausted (>= 5) and stale             |
 * | QC_REJECTED           | Auto-close (nothing to refund)                  |
 * | REFUNDED              | Auto-close (just needs formal completion)       |
 *
 * "Escalate" = publish an event that the admin notification handler catches.
 * "Auto-close" = move to COMPLETED status.
 * "Auto-cancel" = move to CANCELLED status.
 */
@Injectable()
export class StaleReturnProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(StaleReturnProcessorService.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly staleDays: number;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
  ) {
    this.staleDays = this.envService.getNumber('RETURN_STALE_DAYS', 30);
    this.checkIntervalMs =
      this.envService.getNumber(
        'RETURN_STALE_CHECK_INTERVAL_MINUTES',
        60,
      ) * 60_000;
  }

  onModuleInit() {
    if (this.staleDays <= 0) {
      this.logger.log('Stale-return processor disabled (RETURN_STALE_DAYS=0)');
      return;
    }
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `Stale-return tick crashed: ${(err as Error).message}`,
        ),
      );
    }, this.checkIntervalMs);
    this.logger.log(
      `Stale-return processor started (stale=${this.staleDays}d, check every ${this.checkIntervalMs / 60_000}min)`,
    );
  }

  onModuleDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  async tick(): Promise<void> {
    const lockAcquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!lockAcquired) return;

    try {
      const cutoff = new Date(
        Date.now() - this.staleDays * 24 * 60 * 60 * 1000,
      );

      // ── Auto-cancel: REQUESTED / APPROVED that went nowhere ──
      await this.autoCancelStale(cutoff, ['REQUESTED', 'APPROVED']);

      // ── Auto-close: REFUNDED / QC_REJECTED that were never formally closed ──
      await this.autoCloseStale(cutoff, ['REFUNDED', 'QC_REJECTED']);

      // ── Escalate: intermediate states that need human attention ──
      await this.escalateStale(cutoff, [
        'PICKUP_SCHEDULED',
        'IN_TRANSIT',
        'RECEIVED',
      ]);

      // ── Escalate exhausted refund retries ──
      await this.escalateExhaustedRefunds(cutoff);
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }

  private async autoCancelStale(
    cutoff: Date,
    statuses: string[],
  ): Promise<void> {
    const stale = await this.prisma.return.findMany({
      where: {
        status: { in: statuses as any },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, returnNumber: true, status: true },
      take: 50,
    });

    for (const ret of stale) {
      try {
        await this.prisma.return.update({
          where: { id: ret.id },
          data: { status: 'CANCELLED', closedAt: new Date() },
        });
        await this.prisma.returnStatusHistory.create({
          data: {
            returnId: ret.id,
            fromStatus: ret.status,
            toStatus: 'CANCELLED',
            changedBy: 'SYSTEM',
            changedById: 'stale-return-processor',
            notes: `Auto-cancelled — stale in ${ret.status} for ${this.staleDays}+ days`,
          },
        });
        this.logger.log(
          `Auto-cancelled stale return ${ret.returnNumber} (was ${ret.status})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to auto-cancel ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async autoCloseStale(
    cutoff: Date,
    statuses: string[],
  ): Promise<void> {
    const stale = await this.prisma.return.findMany({
      where: {
        status: { in: statuses as any },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, returnNumber: true, status: true },
      take: 50,
    });

    for (const ret of stale) {
      try {
        await this.prisma.return.update({
          where: { id: ret.id },
          data: { status: 'COMPLETED', closedAt: new Date() },
        });
        await this.prisma.returnStatusHistory.create({
          data: {
            returnId: ret.id,
            fromStatus: ret.status,
            toStatus: 'COMPLETED',
            changedBy: 'SYSTEM',
            changedById: 'stale-return-processor',
            notes: `Auto-closed — stale in ${ret.status} for ${this.staleDays}+ days`,
          },
        });
        this.logger.log(
          `Auto-closed stale return ${ret.returnNumber} (was ${ret.status})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to auto-close ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async escalateStale(
    cutoff: Date,
    statuses: string[],
  ): Promise<void> {
    const stale = await this.prisma.return.findMany({
      where: {
        status: { in: statuses as any },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        masterOrderId: true,
        customerId: true,
      },
      take: 50,
    });

    for (const ret of stale) {
      try {
        this.eventBus
          .publish({
            eventName: 'returns.return.stale_escalation',
            aggregate: 'Return',
            aggregateId: ret.id,
            occurredAt: new Date(),
            payload: {
              returnId: ret.id,
              returnNumber: ret.returnNumber,
              currentStatus: ret.status,
              masterOrderId: ret.masterOrderId,
              staleDays: this.staleDays,
            },
          })
          .catch(() => {});
        this.logger.warn(
          `Escalated stale return ${ret.returnNumber} (${ret.status} for ${this.staleDays}+ days)`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to escalate ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async escalateExhaustedRefunds(cutoff: Date): Promise<void> {
    const exhausted = await this.prisma.return.findMany({
      where: {
        status: 'REFUND_PROCESSING',
        refundAttempts: { gte: 5 },
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        returnNumber: true,
        refundAmount: true,
        refundAttempts: true,
        refundFailureReason: true,
      },
      take: 20,
    });

    for (const ret of exhausted) {
      try {
        this.eventBus
          .publish({
            eventName: 'returns.refund.exhausted_escalation',
            aggregate: 'Return',
            aggregateId: ret.id,
            occurredAt: new Date(),
            payload: {
              returnId: ret.id,
              returnNumber: ret.returnNumber,
              refundAmount: Number(ret.refundAmount),
              attempts: ret.refundAttempts,
              lastFailureReason: ret.refundFailureReason,
            },
          })
          .catch(() => {});
        this.logger.warn(
          `Escalated exhausted refund for ${ret.returnNumber} (${ret.refundAttempts} attempts, last: ${ret.refundFailureReason})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to escalate exhausted refund ${ret.returnNumber}: ${(err as Error).message}`,
        );
      }
    }
  }
}
