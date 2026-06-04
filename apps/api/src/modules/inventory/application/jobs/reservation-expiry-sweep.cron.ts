import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StockReservationStatus } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { StockMovementLedgerService } from '../services/stock-movement-ledger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

/**
 * Phase 4.4 (2026-05-16) — Reservation expiry sweep.
 *
 * Phase 52 (2026-05-21) changes:
 *   - sweepOnce now LOOPS over multiple batches inside a single run
 *     (audit Gap #8). Pre-Phase-52 a 2000-row backlog took 4 cron
 *     ticks (~4 minutes) to clear because each tick fetched only
 *     500 rows. Safety cap of MAX_SWEEP_ITERATIONS keeps a runaway
 *     bug from monopolizing the leader's runtime.
 *   - Emits a single inventory.reservation.expired_batch event per
 *     sweep with aggregate counts (Gap #12). Per-row events still
 *     fire for fine-grained ops alerting.
 *   - Stamps StockReservation.expiredAt on the flipped row (Gap #5
 *     telemetry).
 *   - Writes a StockMovement RELEASED ledger row with
 *     referenceType='RESERVATION_EXPIRY' so forensic queries can
 *     distinguish sweep-driven releases from explicit cancel-driven
 *     releases (Gap #9).
 */

const MAX_SWEEP_ITERATIONS = 10;

@Injectable()
export class ReservationExpirySweepCron {
  private readonly logger = new Logger(ReservationExpirySweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly ledger: StockMovementLedgerService,
    // Cluster C (#210-#8) — best-effort tamper-evident summary row per
    // sweep run. The per-row StockMovement ledger already records each
    // individual release (Gap #9); this is the run-level rollup so ops can
    // see WHEN the sweep last ran + how many it expired. @Global AuditModule.
    private readonly audit: AuditPublicFacade,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('RESERVATION_EXPIRY_SWEEP_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('reservation-expiry-sweep', 5 * 60, async () => {
      try {
        await this.sweepUntilEmpty();
      } catch (err) {
        this.logger.error(
          `Reservation expiry sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  /**
   * Phase 52 — loop variant. Calls sweepOnce repeatedly until the
   * batch comes back empty OR we hit MAX_SWEEP_ITERATIONS. Emits a
   * batch-level event at the end with totals.
   */
  async sweepUntilEmpty(): Promise<{
    iterations: number;
    expired: number;
    failed: number;
  }> {
    let totalExpired = 0;
    let totalFailed = 0;
    let iterations = 0;
    for (let i = 0; i < MAX_SWEEP_ITERATIONS; i++) {
      iterations += 1;
      const { expired, failed } = await this.sweepOnce();
      totalExpired += expired;
      totalFailed += failed;
      if (expired === 0 && failed === 0) break;
    }

    if (totalExpired > 0 || totalFailed > 0) {
      this.eventBus
        .publish({
          eventName: 'inventory.reservation.expired_batch',
          aggregate: 'StockReservation',
          aggregateId: 'batch',
          occurredAt: new Date(),
          payload: { expired: totalExpired, failed: totalFailed, iterations },
        })
        .catch(() => {});
      this.logger.log(
        `Reservation expiry sweep run complete — totalExpired=${totalExpired} totalFailed=${totalFailed} iterations=${iterations}`,
      );

      // Cluster C (#210-#8) — one best-effort audit summary row per run,
      // OUTSIDE any per-row transaction (loop has already completed). A
      // logging failure must never abort the sweep, hence `.catch`.
      await this.audit
        .writeAuditLog({
          actorId: 'system',
          actorRole: 'SYSTEM',
          action: 'RESERVATION_EXPIRY_SWEEP',
          module: 'inventory',
          resource: 'stock_reservation',
          resourceId: 'sweep',
          newValue: {
            expired: totalExpired,
            failed: totalFailed,
            iterations,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `Failed to write reservation-expiry sweep audit row: ${(err as Error)?.message ?? err}`,
          ),
        );
    }

    return { iterations, expired: totalExpired, failed: totalFailed };
  }

  async sweepOnce(): Promise<{ expired: number; failed: number }> {
    const batchSize = this.env.getNumber('RESERVATION_EXPIRY_BATCH_SIZE', 500);
    const cutoff = new Date();

    const candidates = await this.prisma.stockReservation.findMany({
      where: {
        status: StockReservationStatus.RESERVED,
        expiresAt: { lt: cutoff },
      },
      select: {
        id: true,
        mappingId: true,
        quantity: true,
        orderId: true,
      },
      take: batchSize,
      orderBy: { expiresAt: 'asc' },
    });

    if (candidates.length === 0) {
      return { expired: 0, failed: 0 };
    }

    this.logger.log(
      `Found ${candidates.length} expired stock reservation(s) — sweeping`,
    );

    let expired = 0;
    let failed = 0;
    for (const r of candidates) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const flip = await tx.stockReservation.updateMany({
            where: { id: r.id, status: StockReservationStatus.RESERVED },
            data: {
              status: StockReservationStatus.EXPIRED,
              expiredAt: new Date(),
            },
          });
          if (flip.count === 0) {
            return null;
          }
          const mappingBefore = await tx.sellerProductMapping.findUnique({
            where: { id: r.mappingId },
            select: { stockQty: true, reservedQty: true },
          });
          if (!mappingBefore) return null;
          const newReserved = Math.max(mappingBefore.reservedQty - r.quantity, 0);
          await tx.sellerProductMapping.update({
            where: { id: r.mappingId },
            data: { reservedQty: newReserved },
          });
          return {
            before: { stockQty: mappingBefore.stockQty, reservedQty: mappingBefore.reservedQty },
            after: { stockQty: mappingBefore.stockQty, reservedQty: newReserved },
          };
        });

        if (result) {
          expired += 1;
          // Phase 52 — ledger entry distinguishes sweep-driven
          // releases (referenceType='RESERVATION_EXPIRY') from
          // explicit cancellations (referenceType='RESERVATION').
          await this.ledger.record({
            resource: 'SellerProductMapping',
            resourceId: r.mappingId,
            kind: 'RELEASED',
            quantityDelta: r.quantity,
            beforeStockQty: result.before.stockQty,
            afterStockQty: result.after.stockQty,
            beforeReservedQty: result.before.reservedQty,
            afterReservedQty: result.after.reservedQty,
            reason: 'Reservation expired (TTL sweep)',
            referenceType: 'RESERVATION_EXPIRY',
            referenceId: r.id,
            actorRole: 'SYSTEM',
          });

          this.eventBus
            .publish({
              eventName: 'inventory.reservation.expired',
              aggregate: 'StockReservation',
              aggregateId: r.id,
              occurredAt: new Date(),
              payload: {
                reservationId: r.id,
                mappingId: r.mappingId,
                quantity: r.quantity,
                orderId: r.orderId,
              },
            })
            .catch(() => {});
        }
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `Failed to expire reservation ${r.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Reservation expiry sweep batch complete — expired=${expired} failed=${failed}`,
    );
    return { expired, failed };
  }
}
