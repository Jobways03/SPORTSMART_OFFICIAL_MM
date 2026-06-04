import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { OrdersService } from './orders.service';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';

// Cluster-B hardening (Phase 161+) — the processor was a raw setInterval
// guarded by an UNFENCED redis.acquireLock/releaseLock pair, with no
// cron-observability and no audit trail. It is now a @Cron job wrapped in
// LeaderElectedCron (cluster-safe, FENCED lock so a TTL-expired holder can't
// delete a successor's lock) + CronInstrumentationService (cron_runs row per
// tick), matching every other cron in the codebase (see
// payment-status-poller.service.ts / reservation-expiry-sweep.cron.ts).
const CRON_JOB_NAME = 'order-acceptance-sla';
// TTL ≥ 2× the per-tick wall-clock. With MAX_BATCHES_PER_TICK batches the
// drain loop is bounded, so 5min is comfortably above the worst case.
const CRON_TTL_SECONDS = 5 * 60;

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
export class OrderAcceptanceSlaProcessor {
  private readonly logger = new Logger(OrderAcceptanceSlaProcessor.name);
  private readonly slaMinutes: number;
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
    private readonly ordersService: OrdersService,
    private readonly franchiseFacade: FranchisePublicFacade,
    // Cluster-B — cluster-safe scheduling + observability + audit, mirroring
    // payment-status-poller.service.ts. LeaderElectedCron / CronInstrumentationService
    // are @Global() exports; AuditPublicFacade comes from AuditModule (already
    // imported by OrdersModule).
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly audit: AuditPublicFacade,
  ) {
    this.slaMinutes = this.envService.getNumber(
      'ORDER_ACCEPTANCE_SLA_MINUTES',
      60,
    );
    this.batchSize = this.envService.getNumber(
      'ORDER_ACCEPTANCE_SLA_BATCH_SIZE',
      DEFAULT_BATCH_SIZE,
    );
  }

  /** Disabled by setting ORDER_ACCEPTANCE_SLA_MINUTES <= 0 (parity with the
   *  pre-conversion onModuleInit guard). */
  private enabled(): boolean {
    return this.slaMinutes > 0;
  }

  // Cluster-B — every minute, leader-elected + instrumented. Replaces the
  // prior onModuleInit setInterval + manual unfenced Redis lock. The leader
  // wrapper IS the distributed lock now (fenced acquire/release), so tick()
  // no longer acquires its own.
  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run(CRON_JOB_NAME, CRON_TTL_SECONDS, async () => {
      try {
        await this.instr.wrap(CRON_JOB_NAME, () => this.tick());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  /**
   * One tick: drain-loop expired sub-orders (acceptDeadlineAt < now).
   * Each row is auto-rejected via the seller or franchise path depending
   * on its fulfillmentNodeType.
   *
   * Distributed-locking is owned by the LeaderElectedCron wrapper in
   * `run()`; this method assumes it already holds the cluster lock.
   *
   * Drain-loop guard: a hard `MAX_BATCHES_PER_TICK` cap prevents a single
   * tick from holding the lock for the full lock TTL window. If the backlog
   * has more than (batchSize * MAX_BATCHES) rows left at the end of the cap,
   * the next tick picks them up.
   */
  async tick(): Promise<{ processed: number; failed: number }> {
    let totalProcessed = 0;
    let totalFailed = 0;
    // Capture the rejected sub-order ids for a single best-effort summary
    // audit row at the end of the tick (NOT one write per row, and NOT inside
    // any per-row transaction — a logging blip must never abort the sweep).
    const rejectedSubOrderIds: string[] = [];

    for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_TICK; batchIdx++) {
      const now = new Date();
      const stale = await this.prisma.subOrder.findMany({
        where: {
          acceptStatus: 'OPEN',
          fulfillmentStatus: { not: 'CANCELLED' },
          // Phase 80 — Gap #3. Filter by the (refreshable) deadline column,
          // NOT createdAt. Reassigned sub-orders get a fresh
          // acceptDeadlineAt; the cron honours it.
          acceptDeadlineAt: { not: null, lt: now },
          // Phase 80 — Gap #5/#18. Branch on nodeType inside the loop; both
          // kinds need processing now.
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
        // Deterministic order — earliest-deadline first so a stuck long-tail
        // row eventually gets retried even if the head of the queue keeps
        // failing.
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
          rejectedSubOrderIds.push(so.id);
        } catch (err) {
          totalFailed++;
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
      // Best-effort, fire-and-forget audit row summarising the tick — one row
      // per sweep (not per reject), outside any transaction. The per-sub-order
      // SUB_ORDER_AUTO_REJECTED row is already written by sellerRejectOrder /
      // the franchise reject path; this CRON-actor row records the sweep
      // action itself so the auto-reject decision is attributable to the job.
      await this.audit
        .writeAuditLog({
          actorId: 'system',
          actorRole: 'SYSTEM',
          actorType: 'CRON',
          action: 'ORDER_AUTO_REJECTED',
          module: 'orders',
          resource: 'SubOrder',
          resourceId: 'sla-sweep',
          metadata: {
            processed: totalProcessed,
            failed: totalFailed,
            slaMinutes: this.slaMinutes,
            reason: 'SLA acceptance deadline elapsed',
            // Cap the id list so a huge backlog tick can't bloat the row.
            subOrderIds: rejectedSubOrderIds.slice(0, 500),
          },
        })
        .catch((err) =>
          this.logger.error(
            `Failed to write SLA auto-reject sweep audit row: ${(err as Error).message}`,
          ),
        );
    }

    return { processed: totalProcessed, failed: totalFailed };
  }
}
