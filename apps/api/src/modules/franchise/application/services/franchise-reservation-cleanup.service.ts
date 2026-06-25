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
  // Phase 159p backlog de-noise. Pre-fix reservations (no correlation id) can't
  // be auto-classified, so the sweeper skips them on every tick. Warning once
  // per row per minute flooded the logs; instead we emit a single summary count
  // and only re-log when the backlog SIZE changes. -1 = "not yet observed".
  private lastLegacySkipCount = -1;

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
    let skippedLegacyCount = 0;
    // Per-tick cache of stock reservedQty, keyed by franchise|product|variant,
    // so classifying many legacy rows for the same SKU costs one lookup.
    const reservedQtyCache = new Map<string, number>();
    for (const reservation of expiredReservations) {
      // Phase 159p (audit #3) — a reservation row with no correlation id
      // predates the lifecycle fix and can't be safely classified as committed
      // vs abandoned. Skip it: a leaked straggler is a one-off for an operator
      // to clear, whereas releasing a committed hold is a customer-facing
      // oversell. (New reservations always carry a referenceId.) Counted here
      // and summarised once after the loop — warning per-row-per-tick flooded
      // the logs every minute for a stable, known backlog.
      if (!reservation.referenceId) {
        // A legacy NULL-ref row is only genuinely "pending manual review" if
        // its stock STILL holds reserved units these rows could account for. If
        // the stock's reservedQty has already settled to 0, the counter
        // reconciled long ago and this is just immutable journal history —
        // re-flagging it every minute is misleading. Only count rows whose
        // stock still carries a reservation that can't be explained.
        const key = `${reservation.franchiseId}|${reservation.productId}|${reservation.variantId ?? ''}`;
        let reservedQty = reservedQtyCache.get(key);
        if (reservedQty === undefined) {
          const fs = await this.prisma.franchiseStock.findFirst({
            where: {
              franchiseId: reservation.franchiseId,
              productId: reservation.productId,
              variantId: reservation.variantId,
            },
            select: { reservedQty: true },
          });
          reservedQty = fs?.reservedQty ?? 0;
          reservedQtyCache.set(key, reservedQty);
        }
        if (reservedQty > 0) {
          skippedLegacyCount++;
        }
        continue;
      }

      // Phase 159p (audit #3) — oversell guard, now order-STATUS aware (mirrors
      // the seller-side StockRestoreService, which branches on the reservation's
      // status). The reservation's correlation id is stamped on an OrderItem at
      // placement, so a linked OrderItem means a real order owns this hold —
      // but WHICH state that order is in decides what the sweeper may do:
      //
      //   • Order still LIVE → its own lifecycle owns the stock (shipment
      //     consumes the hold, cancellation releases it). The sweeper must NOT
      //     touch it: releasing a committed, unshipped hold is an oversell.
      //   • Order CANCELLED/REJECTED → the cancel path is *supposed* to release
      //     the franchise hold (orders.service / franchise-orders.service, keyed
      //     by MASTER-ORDER id), but that call is best-effort and silently leaks
      //     the hold when it throws. The pre-this-change code skipped these
      //     forever because it checked order-line EXISTENCE, not order STATUS —
      //     stranding reservedQty (units locked out of sale). Recover them here,
      //     idempotently against the SAME master-order id the cancel path uses,
      //     so we never double-release a hold the cancel already freed (which
      //     would oversell a LIVE hold sharing this SKU's reservedQty counter).
      const placedOrderItem = await this.prisma.orderItem.findFirst({
        where: { stockReservationId: reservation.referenceId },
        select: {
          id: true,
          subOrder: {
            select: {
              masterOrderId: true,
              fulfillmentStatus: true,
              acceptStatus: true,
              masterOrder: { select: { orderStatus: true } },
            },
          },
        },
      });

      if (placedOrderItem) {
        const so = placedOrderItem.subOrder;
        // `subOrder` is a required relation, but if it's somehow unreadable we
        // can't classify the order — skip rather than risk releasing a live
        // hold (uncertainty must never cause an oversell).
        if (!so) continue;
        const orderIsDead =
          so.fulfillmentStatus === 'CANCELLED' ||
          so.acceptStatus === 'CANCELLED' ||
          so.acceptStatus === 'REJECTED' ||
          so.masterOrder?.orderStatus === 'CANCELLED' ||
          so.masterOrder?.orderStatus === 'REJECTED';

        // Live order → its lifecycle owns the hold. Never touch (oversell guard).
        if (!orderIsDead) continue;

        // Cancelled/rejected order whose hold leaked. Release ONLY if the cancel
        // path hasn't already freed it — idempotency keyed on the master-order
        // id the cancel path passes to unreserveStock, so a SKU with a LIVE hold
        // sharing the counter can never be over-released.
        const cancelAlreadyReleased =
          await this.prisma.franchiseInventoryLedger.findFirst({
            where: {
              franchiseId: reservation.franchiseId,
              productId: reservation.productId,
              variantId: reservation.variantId,
              movementType: { in: ['ORDER_UNRESERVE', 'ORDER_SHIP', 'ORDER_CANCEL'] },
              referenceId: so.masterOrderId,
            },
            select: { id: true },
          });
        if (cancelAlreadyReleased) continue;

        try {
          await this.inventoryService.unreserveStock(
            reservation.franchiseId,
            reservation.productId,
            reservation.variantId,
            Math.abs(reservation.quantityDelta),
            // Tag with the cancel path's id → idempotent against it AND future ticks.
            so.masterOrderId,
          );
          releasedCount++;
        } catch (err) {
          this.logger.warn(
            `Failed to release cancelled-order franchise reservation ` +
              `(master order ${so.masterOrderId}): ${(err as Error).message}`,
          );
        }
        continue;
      }

      // No order line at all → abandoned checkout / deleted order. It may already
      // have been
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

    // Phase 159p backlog — emit ONE summary line, and only when the count
    // changes from the previous tick, so a stable legacy backlog doesn't
    // re-warn every minute. Logs the eventual drop to 0 once, then stays silent.
    if (skippedLegacyCount !== this.lastLegacySkipCount) {
      if (skippedLegacyCount > 0) {
        this.logger.warn(
          `Skipping ${skippedLegacyCount} pre-159p franchise reservation(s) with no correlation id — pending manual review (re-logged only when this count changes).`,
        );
      } else if (this.lastLegacySkipCount > 0) {
        this.logger.log(
          'Pre-159p franchise reservation backlog cleared — no uncorrelated reservations remain.',
        );
      }
      this.lastLegacySkipCount = skippedLegacyCount;
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
