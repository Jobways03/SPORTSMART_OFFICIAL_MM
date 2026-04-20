import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { OrdersService } from './orders.service';

const LOCK_KEY = 'lock:order-acceptance-sla';
const LOCK_TTL = 60;

@Injectable()
export class OrderAcceptanceSlaProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrderAcceptanceSlaProcessor.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly slaMinutes: number;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
    private readonly ordersService: OrdersService,
  ) {
    this.slaMinutes = this.envService.getNumber(
      'ORDER_ACCEPTANCE_SLA_MINUTES',
      60,
    );
    this.checkIntervalMs =
      this.envService.getNumber('ORDER_ACCEPTANCE_SLA_CHECK_SECONDS', 60) *
      1000;
  }

  onModuleInit() {
    if (this.slaMinutes <= 0) {
      this.logger.log('Order acceptance SLA processor disabled (SLA=0)');
      return;
    }
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `Acceptance SLA tick crashed: ${(err as Error).message}`,
        ),
      );
    }, this.checkIntervalMs);
    this.logger.log(
      `Order acceptance SLA processor started (SLA=${this.slaMinutes}min, check every ${this.checkIntervalMs / 1000}s)`,
    );
  }

  onModuleDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  /**
   * One tick: find seller sub-orders that have been sitting in OPEN beyond
   * the SLA and auto-reject each one so the existing seller-rejection flow
   * re-routes them. Franchise sub-orders are skipped here — they gain the
   * same treatment once the franchise-reject flow lands (see Phase 3A-4).
   *
   * Redis lock serialises across API instances so we don't fire the same
   * auto-reject twice if two workers race.
   */
  async tick(): Promise<void> {
    const lockAcquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!lockAcquired) return;

    try {
      const cutoff = new Date(Date.now() - this.slaMinutes * 60_000);
      const stale = await this.prisma.subOrder.findMany({
        where: {
          acceptStatus: 'OPEN',
          fulfillmentStatus: { not: 'CANCELLED' },
          fulfillmentNodeType: 'SELLER',
          sellerId: { not: null },
          createdAt: { lt: cutoff },
        },
        select: { id: true, sellerId: true, createdAt: true },
        take: 50,
      });

      if (stale.length === 0) return;

      for (const so of stale) {
        if (!so.sellerId) continue;
        try {
          await this.ordersService.sellerRejectOrder(so.id, so.sellerId, {
            reason: 'SLA_TIMEOUT',
            note: `Auto-rejected — seller did not accept within ${this.slaMinutes} minutes`,
          });
          this.logger.log(
            `Auto-rejected stale sub-order ${so.id} (sellerId=${so.sellerId}, aged ${Math.floor((Date.now() - so.createdAt.getTime()) / 60_000)}min)`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to auto-reject sub-order ${so.id}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }
}
