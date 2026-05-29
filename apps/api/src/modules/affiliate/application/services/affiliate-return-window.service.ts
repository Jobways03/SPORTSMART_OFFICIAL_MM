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

const LOCK_KEY = 'lock:affiliate-return-window-confirm';
const LOCK_TTL_SECONDS = 30;
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_TICK = 200; // 100k rows/tick ceiling — safety against runaway

/**
 * SRS §11.2 — automated commission confirmation cron.
 *
 * Once per (env-tunable) interval, confirm PENDING commissions whose
 * returnWindowEndsAt has passed. After this transition the commission is
 * eligible for inclusion in a payout request.
 *
 * HOLD commissions are NOT touched — SRS Global Rule "HOLD overrides
 * everything else". Idempotent: a CONFIRMED row won't match the PENDING filter.
 *
 * Phase 159d (audit) — hardened to parity with the seller commission processor:
 *   • fenced Redis lock so multi-pod deployments don't all re-scan every tick;
 *   • env flag + tunable interval (emergency pause without redeploy);
 *   • OnModuleDestroy clears the interval for clean pod eviction;
 *   • batched iteration that publishes `affiliate.commission.locked` PER row
 *     (the bulk updateMany previously confirmed ~100% of commissions silently,
 *     so no downstream subscriber — notifications, audit — ever fired).
 */
@Injectable()
export class AffiliateReturnWindowService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AffiliateReturnWindowService.name);
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit() {
    if (!this.env.getBoolean('AFFILIATE_RETURN_WINDOW_CRON_ENABLED', true)) {
      this.logger.warn(
        'AffiliateReturnWindowService disabled via AFFILIATE_RETURN_WINDOW_CRON_ENABLED=false',
      );
      return;
    }
    const intervalMs = this.env.getNumber(
      'AFFILIATE_RETURN_WINDOW_CRON_INTERVAL_MS',
      60_000,
    );
    // First sweep shortly after boot (API fully up), then on the interval.
    setTimeout(() => void this.sweep(), 5_000);
    this.tickTimer = setInterval(() => void this.sweep(), intervalMs);
  }

  onModuleDestroy() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  async sweep(): Promise<{ confirmed: number }> {
    // Fenced distributed lock — only one pod sweeps per tick. Atomic
    // updateMany already prevents double-flips; the lock prevents N pods
    // each re-scanning the table every interval.
    const { acquired, token } = await this.redis.acquireLockWithToken(
      LOCK_KEY,
      LOCK_TTL_SECONDS,
    );
    if (!acquired) return { confirmed: 0 };

    try {
      let totalConfirmed = 0;
      for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch++) {
        const candidates = await this.prisma.affiliateCommission.findMany({
          where: {
            status: 'PENDING',
            returnWindowEndsAt: { not: null, lte: new Date() },
          },
          select: { id: true, affiliateId: true, orderId: true },
          take: BATCH_SIZE,
        });
        if (candidates.length === 0) break;

        // Atomic claim — the status guard makes a concurrent manual confirm
        // (or a racing pod, though the lock prevents that) a no-op for the row.
        const claimed = await this.prisma.affiliateCommission.updateMany({
          where: { id: { in: candidates.map((c) => c.id) }, status: 'PENDING' },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });
        totalConfirmed += claimed.count;

        // Publish the lock event per row so downstream subscribers
        // (notifications, audit) fire — best-effort, idempotent on aggregateId.
        for (const c of candidates) {
          await this.eventBus
            .publish({
              eventName: 'affiliate.commission.locked',
              aggregate: 'AffiliateCommission',
              aggregateId: c.id,
              occurredAt: new Date(),
              payload: {
                commissionId: c.id,
                affiliateId: c.affiliateId,
                orderId: c.orderId,
                status: 'CONFIRMED',
                source: 'RETURN_WINDOW_CRON',
              },
            })
            .catch((err) =>
              this.logger.warn(
                `Failed to publish affiliate.commission.locked for ${c.id}: ${(err as Error).message}`,
              ),
            );
        }

        if (candidates.length < BATCH_SIZE) break;
      }

      if (totalConfirmed > 0) {
        this.logger.log(
          `Return-window cron: confirmed ${totalConfirmed} affiliate commission(s)`,
        );
      }
      return { confirmed: totalConfirmed };
    } catch (err) {
      this.logger.error(
        `Return-window cron failed: ${(err as Error)?.message ?? err}`,
      );
      return { confirmed: 0 };
    } finally {
      if (token) await this.redis.releaseLockWithToken(LOCK_KEY, token);
    }
  }
}
