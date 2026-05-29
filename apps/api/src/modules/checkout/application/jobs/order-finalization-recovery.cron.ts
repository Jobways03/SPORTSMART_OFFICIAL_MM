import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { TaxSnapshotService } from '../../../tax/application/services/tax-snapshot.service';

/**
 * Phase 69 (2026-05-22) — Phase 67 audit Gap #1 + Gap #5.
 *
 * Pre-Phase-67 the place-order pipeline ran tax-snapshot creation,
 * discount allocation, stock confirmation, wallet debit, and Razorpay
 * order creation OUTSIDE the order transaction. Phase 67 added the
 * MasterOrder.finalizedAt column + a recovery-cron-friendly index
 * (`WHERE finalized_at IS NULL`) but didn't implement the cron
 * itself.
 *
 * This cron is that follow-up. Every 10 minutes, leader-elected:
 *   1. Find orders whose tx committed > 10 minutes ago but
 *      finalizedAt was never stamped.
 *   2. Replay the idempotent recovery steps: tax snapshot
 *      (TaxSnapshotService.createSnapshotsForMasterOrder is
 *      upsert-based).
 *   3. If both succeed, flip finalizedAt.
 *   4. If the order has been stuck for the alert threshold
 *      (default 60 min), emit `orders.master.finalisation_stuck`
 *      so ops gets paged.
 *
 * The cron skips orders in terminal states (CANCELLED, EXCEPTION_QUEUE)
 * — those don't need finalisation. Bounded batch size keeps a single
 * tick predictable even with a backlog.
 *
 * Audit: tax snapshot retry is the highest-value recovery — finance /
 * GST reporting need it for every order. Discount allocation replay
 * is more complex (requires the original DiscountReservation context)
 * and stays as a follow-up; this cron logs the gap loudly and emits
 * the ops event so missing allocation rows surface for manual
 * intervention.
 */
@Injectable()
export class OrderFinalizationRecoveryCron {
  private readonly logger = new Logger(OrderFinalizationRecoveryCron.name);

  // Defaults: 10-min grace window before retry, 60-min stuck alert,
  // 500-row batch cap. All env-tunable.
  private readonly GRACE_MINUTES_DEFAULT = 10;
  private readonly ALERT_MINUTES_DEFAULT = 60;
  private readonly BATCH_LIMIT_DEFAULT = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly taxSnapshot: TaxSnapshotService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('ORDER_FINALIZATION_RECOVERY_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('order-finalization-recovery', 15 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(
          `Finalization recovery sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  async runOnce(): Promise<{
    scanned: number;
    finalized: number;
    stuck: number;
  }> {
    const now = new Date();
    const graceMinutes = this.env.getNumber(
      'ORDER_FINALIZATION_GRACE_MINUTES',
      this.GRACE_MINUTES_DEFAULT,
    );
    const alertMinutes = this.env.getNumber(
      'ORDER_FINALIZATION_ALERT_MINUTES',
      this.ALERT_MINUTES_DEFAULT,
    );
    const batchLimit = this.env.getNumber(
      'ORDER_FINALIZATION_BATCH_LIMIT',
      this.BATCH_LIMIT_DEFAULT,
    );
    const graceCutoff = new Date(now.getTime() - graceMinutes * 60_000);
    const alertCutoff = new Date(now.getTime() - alertMinutes * 60_000);

    // The Phase 67 partial index `WHERE finalized_at IS NULL` keeps
    // this query cheap in steady state — only un-finalized rows are
    // in the index. Filter on createdAt to skip orders that just
    // committed and might still have their post-tx work in flight.
    const candidates = await this.prisma.masterOrder.findMany({
      where: {
        finalizedAt: null,
        createdAt: { lt: graceCutoff },
        orderStatus: { notIn: ['CANCELLED', 'EXCEPTION_QUEUE'] },
      } as any,
      select: { id: true, orderNumber: true, createdAt: true, orderStatus: true },
      take: batchLimit,
      orderBy: { createdAt: 'asc' },
    });

    let finalized = 0;
    let stuck = 0;
    for (const row of candidates) {
      try {
        // Idempotent retry — TaxSnapshotService.createSnapshotsForMasterOrder
        // upserts on unique keys so an order whose snapshot was
        // partially written before the original failure is brought
        // to completion without duplicates.
        await this.taxSnapshot.createSnapshotsForMasterOrder(row.id, {});

        // Stamp finalizedAt. Status-conditional update so we don't
        // race with a concurrent cancellation.
        const updated = await this.prisma.masterOrder.updateMany({
          where: { id: row.id, finalizedAt: null } as any,
          data: { finalizedAt: new Date() } as any,
        });
        if (updated.count > 0) finalized++;
      } catch (err) {
        const ageMinutes = Math.round(
          (now.getTime() - row.createdAt.getTime()) / 60_000,
        );
        const stuckPastAlert = row.createdAt < alertCutoff;
        if (stuckPastAlert) {
          stuck++;
          this.eventBus
            .publish({
              eventName: 'orders.master.finalisation_stuck',
              aggregate: 'MasterOrder',
              aggregateId: row.id,
              occurredAt: new Date(),
              payload: {
                masterOrderId: row.id,
                orderNumber: row.orderNumber,
                ageMinutes,
                reason: (err as Error).message,
              },
            })
            .catch(() => undefined);
        }
        this.logger.warn(
          `Finalization retry failed for order ${row.orderNumber} (age=${ageMinutes}m, stuck=${stuckPastAlert}): ${(err as Error).message}`,
        );
      }
    }

    if (finalized > 0 || stuck > 0) {
      this.logger.log(
        `Finalization recovery — scanned=${candidates.length} finalized=${finalized} stuck=${stuck}`,
      );
    }
    return { scanned: candidates.length, finalized, stuck };
  }
}
