import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { FranchiseInventoryService } from './franchise-inventory.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

/**
 * Phase 1 (PR 1.8) — Franchise reservation sweeper.
 *
 * Audit HI-39 flagged that the franchise side lacked the seller-side
 * `StockReservation.expiresAt` + sweeper pair. This service was
 * already present but with three weaknesses:
 *
 *   1. `setInterval`-based — didn't fit the project's @Cron
 *      convention and couldn't be paused via the same env-flag
 *      pattern as the other crons.
 *   2. Ad-hoc Redis lock — used the un-fenced `acquireLock` / plain
 *      `DEL` primitives, so a TTL-mid-work race could let two
 *      replicas double-release the same reservation.
 *   3. No env-flag — ops couldn't pause it during incidents.
 *
 * PR 1.8 resolves all three: `@Cron(EVERY_MINUTE)`, `LeaderElectedCron`
 * (uses PR 1.7's fenced token-CAS release), and the new
 * `FRANCHISE_RESERVATION_SWEEP_ENABLED` env-flag. Default ON because
 * a stuck reservation is silent inventory loss — better noisy than
 * silent.
 *
 * The franchise side uses ledger-row scan (`FranchiseInventoryLedger`
 * rows with `movementType = ORDER_RESERVE` and no matching follow-up)
 * rather than a dedicated `StockReservation` table with `expiresAt`.
 * The ledger approach is correct for the franchise model (inventory
 * is journaled by movement type) — adding a parallel `expiresAt`
 * column would duplicate the source of truth.
 *
 * Phase 159p (audit #3) — the scan alone was unsafe: it could not tell a
 * committed order's hold from an abandoned cart, so it released
 * committed-but-unshipped reservations (oversell). The reserve now carries a
 * correlation id (`referenceId`) that is also stamped onto
 * `OrderItem.stockReservationId` at order placement. `cleanup()` therefore
 * releases a reservation ONLY when it is uncorrelated to any placed order AND
 * has no release/ship follow-up — i.e. a genuine abandoned-cart hold. Anything
 * tied to a placed order is left to that order's own lifecycle.
 */
@Injectable()
export class FranchiseReservationCleanupService {
  // Kept in sync with the seller-side TTL
  // (seller-allocation.service.ts:reserveStock default `expiresInMinutes = 15`)
  // so a customer sees the same checkout hold regardless of which node the
  // cart was routed to. If you tune one, tune the other.
  private readonly RESERVATION_TTL_MINUTES = 15;
  private lastContractCheck = 0;
  private readonly CONTRACT_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly inventoryService: FranchiseInventoryService,
    private readonly logger: AppLoggerService,
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.1) — cron-run observability. Every tick lands a
    // row in `cron_runs` with start/end/status + the structured
    // `{ released, contractsSuspended }` shape the heartbeat
    // dashboard charts.
    private readonly instr: CronInstrumentationService,
    // Cluster C — best-effort tamper-evident summary row per tick so
    // a forensic review can see WHEN the sweeper last released stale
    // holds (and how many) without rebuilding from the ledger. @Global
    // AuditModule, no module import needed.
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('FranchiseReservationCleanupService');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.env.getBoolean('FRANCHISE_RESERVATION_SWEEP_ENABLED', true)) return;

    // 2-minute lock so a slow sweep (large backlog) finishes before
    // the next tick tries to claim the lock.
    await this.leader.run('franchise-reservation-cleanup', 2 * 60, async () => {
      try {
        // Phase 5 (PR 5.1) — wrap so each tick is auditable. Errors
        // re-thrown by the body land status=FAILED in cron_runs; the
        // outer try/catch then swallows so the cron tick itself
        // doesn't propagate to @nestjs/schedule.
        await this.instr.wrap('franchise-reservation-cleanup', async () => {
          const released = await this.cleanup();
          let contractsSuspended = 0;
          if (Date.now() - this.lastContractCheck > this.CONTRACT_CHECK_INTERVAL) {
            contractsSuspended = await this.checkExpiredContracts();
            this.lastContractCheck = Date.now();
          }

          // Cluster C — one best-effort audit summary row per tick when
          // anything was actually released/suspended. Written here at the
          // tick boundary (OUTSIDE cleanup()'s per-reservation work) so a
          // logging failure never aborts the sweep; `.catch` keeps it
          // non-fatal.
          if (released > 0 || contractsSuspended > 0) {
            await this.audit
              .writeAuditLog({
                actorId: 'system',
                actorRole: 'SYSTEM',
                action: 'FRANCHISE_RESERVATION_CLEANUP',
                module: 'franchise',
                resource: 'franchise_inventory_ledger',
                resourceId: 'sweep',
                newValue: { released, contractsSuspended },
              })
              .catch((err) =>
                this.logger.warn(
                  `Failed to write franchise-reservation cleanup audit row: ${(err as Error)?.message ?? 'unknown error'}`,
                ),
              );
          }

          return { released, contractsSuspended };
        });
      } catch (err) {
        this.logger.error(
          `Franchise cleanup tick failed: ${(err as Error)?.message ?? 'unknown error'}`,
        );
      }
    });
  }

  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - this.RESERVATION_TTL_MINUTES * 60 * 1000);

    // Cluster C — bound the scan. Pre-fix this was an unbounded findMany:
    // a large backlog (or a bug leaving rows un-released) would pull every
    // stale ORDER_RESERVE row into memory in one tick. Cap it; the leftover
    // rows are picked up on the next EVERY_MINUTE tick (ordered oldest-first
    // so the oldest holds clear first).
    const batchSize = this.env.getNumber(
      'FRANCHISE_RESERVATION_CLEANUP_BATCH_SIZE',
      500,
    );

    // Find ORDER_RESERVE entries older than TTL that may not have been released
    const expiredReservations = await this.prisma.franchiseInventoryLedger.findMany({
      where: {
        movementType: 'ORDER_RESERVE',
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        franchiseId: true,
        productId: true,
        variantId: true,
        globalSku: true,
        quantityDelta: true,
        referenceId: true,
      },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });

    let releasedCount = 0;
    for (const reservation of expiredReservations) {
      // Phase 159p (audit #3) — a reservation row with no correlation id
      // predates the lifecycle fix and can't be safely classified as committed
      // vs abandoned. Skip it: a leaked straggler is a one-off for an operator
      // to clear, whereas releasing a committed hold is a customer-facing
      // oversell. (New reservations always carry a referenceId.)
      if (!reservation.referenceId) {
        this.logger.warn(
          `Skipping franchise reservation ${reservation.id} — no correlation id (pre-159p); needs manual review`,
        );
        continue;
      }

      // Phase 159p (audit #3) — THE oversell fix. If this reservation is linked
      // to a placed order (its correlation id is stamped on an OrderItem), the
      // order's own lifecycle owns the stock — shipment consumes the hold,
      // cancellation releases it. The sweeper must never touch it. Pre-159p the
      // cron released committed-but-unshipped holds because it couldn't see this
      // link, freeing stock that a paid order still needed → oversell.
      const placedOrderItem = await this.prisma.orderItem.findFirst({
        where: { stockReservationId: reservation.referenceId },
        select: { id: true },
      });
      if (placedOrderItem) continue;

      // No order was ever placed → abandoned checkout. It may already have been
      // released by a checkout re-run / placeOrder rollback; the follow-up
      // (now correlated by the shared id) prevents a double release.
      const followUp = await this.prisma.franchiseInventoryLedger.findFirst({
        where: {
          franchiseId: reservation.franchiseId,
          productId: reservation.productId,
          variantId: reservation.variantId,
          movementType: { in: ['ORDER_UNRESERVE', 'ORDER_SHIP', 'ORDER_CANCEL'] },
          referenceId: reservation.referenceId,
        },
      });
      if (followUp) continue;

      // Genuinely stale abandoned-cart hold — release it.
      try {
        await this.inventoryService.unreserveStock(
          reservation.franchiseId,
          reservation.productId,
          reservation.variantId,
          Math.abs(reservation.quantityDelta),
          reservation.referenceId || undefined,
        );
        releasedCount++;
      } catch (err) {
        this.logger.warn(`Failed to release stale reservation: ${(err as Error).message}`);
      }
    }

    if (releasedCount > 0) {
      this.logger.log(`Released ${releasedCount} expired franchise stock reservation(s)`);
    }
    return releasedCount;
  }

  // ── Auto-suspend franchises with expired contracts ──────────────────

  private async checkExpiredContracts(): Promise<number> {
    const expired = await this.prisma.franchisePartner.findMany({
      where: {
        status: 'ACTIVE',
        contractEndDate: { lt: new Date() },
        isDeleted: false,
      },
      select: { id: true, franchiseCode: true },
    });

    for (const franchise of expired) {
      await this.prisma.franchisePartner.update({
        where: { id: franchise.id },
        data: { status: 'SUSPENDED' },
      });
      this.logger.warn(
        `Franchise ${franchise.franchiseCode} auto-suspended — contract expired`,
      );
    }
    return expired.length;
  }
}
