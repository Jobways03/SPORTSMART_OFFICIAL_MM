import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AccountsSettlementService } from './accounts-settlement.service';

const LOCK_KEY = 'lock:settlement-auto-cycle';
const LOCK_TTL = 120;

@Injectable()
export class SettlementCycleProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SettlementCycleProcessorService.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly enabled: boolean;
  private readonly periodDays: number;
  private readonly tickIntervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
    private readonly settlementService: AccountsSettlementService,
  ) {
    this.enabled =
      this.envService
        .getString('SETTLEMENT_AUTO_CYCLE_ENABLED', 'false')
        .toLowerCase() === 'true';
    this.periodDays = this.envService.getNumber(
      'SETTLEMENT_CYCLE_PERIOD_DAYS',
      7,
    );
    this.tickIntervalMs =
      this.envService.getNumber('SETTLEMENT_AUTO_CYCLE_INTERVAL_MINUTES', 60) *
      60_000;
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Settlement auto-cycle processor disabled');
      return;
    }
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `Settlement auto-cycle tick crashed: ${(err as Error).message}`,
        ),
      );
    }, this.tickIntervalMs);
    this.logger.log(
      `Settlement auto-cycle processor started (every ${this.tickIntervalMs / 60_000}min, period=${this.periodDays}d)`,
    );
  }

  onModuleDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  /**
   * One tick: advance the cycle pointer forward by `periodDays` as each window
   * closes. We roll one period at a time — if the processor was offline for
   * weeks, subsequent ticks will keep catching up until current. The Redis
   * lock stops multiple API instances from racing to create the same cycle.
   */
  async tick(): Promise<void> {
    const lockAcquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!lockAcquired) return;

    try {
      const mostRecent = await this.prisma.settlementCycle.findFirst({
        orderBy: { periodEnd: 'desc' },
      });

      const now = new Date();

      const nextStart = mostRecent
        ? new Date(mostRecent.periodEnd.getTime() + 1)
        : this.initialPeriodStart(now);

      const nextEnd = new Date(nextStart);
      nextEnd.setDate(nextEnd.getDate() + this.periodDays);
      nextEnd.setHours(23, 59, 59, 999);

      // Only create once the window has fully closed so we don't slice an
      // in-progress day. If next period hasn't ended yet, nothing to do.
      if (nextEnd > now) return;

      const result = await this.settlementService.createUnifiedSettlementCycle(
        nextStart,
        nextEnd,
      );

      if (result.cycle) {
        this.logger.log(
          `Auto-created settlement cycle ${result.cycle.id} for ${nextStart.toISOString()} → ${nextEnd.toISOString()} (sellers=${result.sellerSettlementCount}, franchises=${result.franchiseSettlementCount})`,
        );
      } else {
        // No pending records in window — skip creating an empty cycle by
        // inserting a zero-valued placeholder so the pointer still advances.
        // Otherwise the processor would spin on the same empty window forever.
        await this.prisma.settlementCycle.create({
          data: {
            periodStart: nextStart,
            periodEnd: nextEnd,
            status: 'PAID',
            totalAmount: 0,
            totalMargin: 0,
          },
        });
        this.logger.log(
          `No pending records for ${nextStart.toISOString()} → ${nextEnd.toISOString()}; created empty PAID cycle to advance pointer.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Settlement auto-cycle tick failed: ${(err as Error).message}`,
      );
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }

  private initialPeriodStart(now: Date): Date {
    const start = new Date(now);
    start.setDate(start.getDate() - this.periodDays);
    start.setHours(0, 0, 0, 0);
    return start;
  }
}
