import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

/**
 * Phase 3 (PR 3.5) — COD-refund-pending cron.
 *
 * COD orders refund via bank transfer / UPI, not the original payment
 * gateway. The instruction enters MANUAL_REQUIRED until ops wires the
 * money externally and confirms. This cron flags any MANUAL_REQUIRED
 * refund older than the configured threshold (default 48h) so finance
 * sees them in the daily standup queue rather than discovering them
 * when the customer escalates.
 */
@Injectable()
export class CodRefundPendingCron
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CodRefundPendingCron.name);
  private static readonly LOCK_KEY = 'lock:cod-refund-pending';
  private static readonly LOCK_TTL_SECONDS = 300;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    private readonly events: EventBusService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) {
      this.logger.log('COD-refund-pending recon disabled');
      return;
    }
    const minutes = this.env.getNumber(
      'COD_REFUND_PENDING_INTERVAL_MINUTES',
      4 * 60, // every 4h
    );
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `cod-refund-pending tick crashed: ${(err as Error).message}`,
        ),
      );
    }, minutes * 60_000);
    this.logger.log(
      `COD-refund-pending cron started (every ${minutes} minutes)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<{ pending: number; aged: number }> {
    if (!this.enabled()) return { pending: 0, aged: 0 };

    const got = await this.redis.acquireLock(
      CodRefundPendingCron.LOCK_KEY,
      CodRefundPendingCron.LOCK_TTL_SECONDS,
    );
    if (!got) return { pending: 0, aged: 0 };

    try {
      const stuckHours = this.env.getNumber(
        'COD_REFUND_PENDING_STUCK_HOURS',
        48,
      );
      const cutoff = new Date(Date.now() - stuckHours * 3_600_000);

      const aged = await this.prisma.refundInstruction.findMany({
        where: {
          status: 'MANUAL_REQUIRED',
          createdAt: { lt: cutoff },
        },
        select: {
          id: true,
          customerId: true,
          orderId: true,
          amountInPaise: true,
          createdAt: true,
        },
        take: 100,
      });

      for (const i of aged) {
        this.events
          .publish({
            eventName: 'refund.cod.pending_aged',
            aggregate: 'RefundInstruction',
            aggregateId: i.id,
            occurredAt: new Date(),
            payload: {
              instructionId: i.id,
              customerId: i.customerId,
              orderId: i.orderId,
              amountInPaise: Number(i.amountInPaise),
              ageHours: Math.floor(
                (Date.now() - i.createdAt.getTime()) / 3_600_000,
              ),
            },
          })
          .catch(() => undefined);
      }

      // Total MANUAL_REQUIRED count for the dashboard gauge.
      const pending = await this.prisma.refundInstruction.count({
        where: { status: 'MANUAL_REQUIRED' },
      });

      this.logger.log(
        `cod-refund-pending: total_manual_required=${pending} aged_over_${stuckHours}h=${aged.length}`,
      );
      return { pending, aged: aged.length };
    } finally {
      await this.redis.releaseLock(CodRefundPendingCron.LOCK_KEY);
    }
  }

  private enabled(): boolean {
    return this.env.getBoolean('COD_REFUND_PENDING_ENABLED', false);
  }
}
