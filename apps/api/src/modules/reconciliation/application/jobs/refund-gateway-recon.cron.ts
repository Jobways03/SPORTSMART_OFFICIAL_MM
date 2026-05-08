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
 * Phase 3 (PR 3.5) — Refund-gateway reconciliation cron.
 *
 * Every Razorpay refund creates a `RefundInstruction` row in PROCESSING
 * with `gatewayRefundId` set. The publisher cron drains domain events,
 * but reconciliation against the gateway's GET endpoint is a separate
 * concern: did the bank actually settle the refund?
 *
 * For each PROCESSING instruction with `gatewayRefundId`:
 *   - Hit Razorpay's GET /payments/{p}/refunds/{r}
 *   - If gateway says "processed" → instruction → SUCCESS
 *   - If gateway says "failed" → instruction → FAILED
 *   - If still pending → leave alone, retry next tick
 *   - If 24h+ stuck pending → fire `refund.gateway.stuck` event
 *
 * For Phase 3 we only set up the SCHEDULING + a stub that finds the
 * stuck rows. Hooking up the actual gateway GET happens in PR 3.6 / a
 * follow-up that decoupes RefundGatewayService from the legacy returns
 * path. The skeleton here exists so PR 3.5 ships testable plumbing.
 */
@Injectable()
export class RefundGatewayReconCron
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RefundGatewayReconCron.name);
  private static readonly LOCK_KEY = 'lock:refund-gateway-recon';
  private static readonly LOCK_TTL_SECONDS = 300;
  private static readonly STUCK_AFTER_HOURS = 24;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    private readonly events: EventBusService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) {
      this.logger.log('Refund-gateway recon disabled');
      return;
    }
    const minutes = this.env.getNumber(
      'REFUND_GATEWAY_RECON_INTERVAL_MINUTES',
      60,
    );
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `refund-gateway recon tick crashed: ${(err as Error).message}`,
        ),
      );
    }, minutes * 60_000);
    this.logger.log(
      `Refund-gateway recon cron started (every ${minutes} minutes)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<{ checked: number; stuck: number }> {
    if (!this.enabled()) return { checked: 0, stuck: 0 };

    const got = await this.redis.acquireLock(
      RefundGatewayReconCron.LOCK_KEY,
      RefundGatewayReconCron.LOCK_TTL_SECONDS,
    );
    if (!got) return { checked: 0, stuck: 0 };

    try {
      const stuckCutoff = new Date(
        Date.now() - RefundGatewayReconCron.STUCK_AFTER_HOURS * 3_600_000,
      );

      // Find PROCESSING instructions older than 24h with a gateway id.
      // Real Razorpay GET integration is queued for PR 3.6+; for now
      // we just identify and emit an event so ops gets surfaced.
      const stuck = await this.prisma.refundInstruction.findMany({
        where: {
          status: 'PROCESSING',
          gatewayRefundId: { not: null },
          updatedAt: { lt: stuckCutoff },
        },
        select: {
          id: true,
          customerId: true,
          gatewayRefundId: true,
          updatedAt: true,
        },
        take: 50,
      });

      for (const i of stuck) {
        this.events
          .publish({
            eventName: 'refund.gateway.stuck',
            aggregate: 'RefundInstruction',
            aggregateId: i.id,
            occurredAt: new Date(),
            payload: {
              instructionId: i.id,
              customerId: i.customerId,
              gatewayRefundId: i.gatewayRefundId,
              stuckSinceMs: Date.now() - i.updatedAt.getTime(),
            },
          })
          .catch(() => undefined);
      }

      this.logger.log(
        `refund-gateway recon: checked stuck refunds, count=${stuck.length}`,
      );
      return { checked: stuck.length, stuck: stuck.length };
    } finally {
      await this.redis.releaseLock(RefundGatewayReconCron.LOCK_KEY);
    }
  }

  private enabled(): boolean {
    return this.env.getBoolean('REFUND_GATEWAY_RECON_ENABLED', false);
  }
}
