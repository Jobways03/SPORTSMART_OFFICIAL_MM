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
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';

const LOCK_KEY = 'lock:order-acceptance-sla';
const LOCK_TTL = 60;
const DEFAULT_BATCH_SIZE = 100;
// Safety bound so a runaway expired-row backlog can't hold the lock
// indefinitely. With 100 per batch and ~10 batches we process up to
// 1000 sub-orders per tick before yielding the lock.
const MAX_BATCHES_PER_TICK = 10;

/**
 * Phase 80 (2026-05-22) — acceptance audit Gaps #2, #3, #5, #6, #10,
 * #11, #18.
 *
 * Unified replacement for the pre-Phase-80 dual cron stack
 * (`OrderTimeoutService` at 5min + this processor at 1min). The two
 * crons used different locks → could both process the same row in
 * the same minute. The 5-min one used `acceptDeadlineAt < now` (the
 * correct filter); this one used `createdAt < now - SLA_MINUTES`,
 * which broke after a reassignment refreshed the deadline (Gap #3).
 *
 * Phase 80 keeps THIS class (renames-in-effect: it's now the only
 * acceptance-expiry cron) but:
 *
 *   • Switches the filter to `acceptDeadlineAt < now` (Gap #3) so a
 *     reassigned sub-order's fresh deadline is honoured.
 *   • Branches by `fulfillmentNodeType` so franchise sub-orders are
 *     auto-rejected via `franchiseOrdersService.rejectOrder`
 *     instead of being silently skipped (Gap #5).
 *   • Drain-loops within one lock acquisition (Gap #10/#11) so a
 *     weekend backlog doesn't accumulate indefinitely.
 *   • Calls `sellerRejectOrder(..., { auto: true })` which stamps
 *     rejectionType=AUTO_SLA + autoRejectedAt and uses a valid enum
 *     reason value (`OTHER`) — Gap #6 closed because the SLA_TIMEOUT
 *     discrimination now lives on the rejectionType column, not in
 *     the bespoke rejectionReason string.
 *   • Filters by `fulfillmentNodeType IN (SELLER, FRANCHISE)` only
 *     to avoid future nodeTypes silently breaking the cron.
 */
@Injectable()
export class OrderAcceptanceSlaProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrderAcceptanceSlaProcessor.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly slaMinutes: number;
  private readonly checkIntervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
    private readonly ordersService: OrdersService,
    private readonly franchiseFacade: FranchisePublicFacade,
  ) {
    this.slaMinutes = this.envService.getNumber(
      'ORDER_ACCEPTANCE_SLA_MINUTES',
      60,
    );
    this.checkIntervalMs =
      this.envService.getNumber('ORDER_ACCEPTANCE_SLA_CHECK_SECONDS', 60) *
      1000;
    this.batchSize = this.envService.getNumber(
      'ORDER_ACCEPTANCE_SLA_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
    );
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
      `Order acceptance SLA processor started (SLA=${this.slaMinutes}min, check every ${this.checkIntervalMs / 1000}s, batchSize=${this.batchSize})`,
    );
  }

  onModuleDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  /**
   * One tick: drain-loop expired sub-orders (acceptDeadlineAt < now)
   * within a single lock acquisition. Each row is auto-rejected via
   * the seller or franchise path depending on its fulfillmentNodeType.
   *
   * Drain-loop guard: a hard `MAX_BATCHES_PER_TICK` cap prevents a
   * single tick from holding the Redis lock for the full lock TTL
   * window. If the backlog has more than (batchSize * MAX_BATCHES)
   * rows left at the end of the cap, the next tick picks them up.
   */
  async tick(): Promise<void> {
    const lockAcquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!lockAcquired) return;

    let totalProcessed = 0;
    try {
      for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_TICK; batchIdx++) {
        const now = new Date();
        const stale = await this.prisma.subOrder.findMany({
          where: {
            acceptStatus: 'OPEN',
            fulfillmentStatus: { not: 'CANCELLED' },
            // Phase 80 — Gap #3. Filter by the (refreshable)
            // deadline column, NOT createdAt. Reassigned sub-orders
            // get a fresh acceptDeadlineAt; the cron honours it.
            acceptDeadlineAt: { not: null, lt: now },
            // Phase 80 — Gap #5/#18. Branch on nodeType inside the
            // loop; both kinds need processing now.
            fulfillmentNodeType: { in: ['SELLER', 'FRANCHISE'] },
          },
          select: {
            id: true,
            sellerId: true,
            franchiseId: true,
            fulfillmentNodeType: true,
            acceptDeadlineAt: true,
          },
          take: this.batchSize,
          // Deterministic order — earliest-deadline first so a stuck
          // long-tail row eventually gets retried even if the head of
          // the queue keeps failing.
          orderBy: { acceptDeadlineAt: 'asc' },
        });

        if (stale.length === 0) break;

        for (const so of stale) {
          try {
            if (so.fulfillmentNodeType === 'FRANCHISE') {
              if (!so.franchiseId) {
                this.logger.warn(
                  `Skipping franchise sub-order ${so.id} with null franchiseId`,
                );
                continue;
              }
              await this.franchiseFacade.rejectFranchiseOrder(
                so.id,
                so.franchiseId,
                {
                  reason: 'OTHER',
                  note: `Auto-rejected — franchise did not accept within ${this.slaMinutes} minutes`,
                  auto: true,
                },
              );
            } else {
              if (!so.sellerId) {
                this.logger.warn(
                  `Skipping seller sub-order ${so.id} with null sellerId`,
                );
                continue;
              }
              await this.ordersService.sellerRejectOrder(so.id, so.sellerId, {
                reason: 'OTHER',
                note: `Auto-rejected — seller did not accept within ${this.slaMinutes} minutes`,
                auto: true,
              });
            }
            totalProcessed++;
          } catch (err) {
            this.logger.error(
              `Failed to auto-reject sub-order ${so.id} (${so.fulfillmentNodeType}): ${(err as Error).message}`,
            );
          }
        }

        // If the batch wasn't full, no more work to do this tick.
        if (stale.length < this.batchSize) break;
      }

      if (totalProcessed > 0) {
        this.logger.log(
          `Auto-rejected ${totalProcessed} expired sub-order(s) this tick`,
        );
      }
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }
}
