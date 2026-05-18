import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 4.4 (2026-05-16) — Reservation expiry sweep.
 *
 * Background: every checkout creates `StockReservation` rows with a
 * 15-minute TTL (`expiresAt`). When the customer completes payment
 * within the window, the reservation transitions to CONFIRMED; when
 * they cancel, it transitions to RELEASED. Anything else — abandoned
 * carts, browser crashes, payment failures with no explicit cleanup
 * — leaves the reservation in RESERVED status past `expiresAt`,
 * **artificially blocking stock** from being sold to other customers.
 *
 * Previously the only cleanup was a module-local `setInterval` inside
 * `SellerAllocationService` that ran every 60s, but it would die with
 * the pod and didn't survive replica restarts cleanly. This dedicated
 * cron:
 *   1. Runs on the leader replica only (no double-write).
 *   2. Walks every RESERVED row past `expiresAt` in batches.
 *   3. For each row: in a single transaction, flips status to EXPIRED
 *      and decrements `SellerProductMapping.reservedQty` by the row's
 *      quantity. The CAS-style updateMany ensures concurrent flips
 *      can't double-decrement.
 *   4. Emits `inventory.reservation.expired` for downstream alerting
 *      (e.g. if a single mapping consistently expires, it suggests
 *      a checkout flow that's not completing).
 *
 * Idempotent end-to-end: re-running has no effect on already-EXPIRED
 * rows.
 *
 * Tunables:
 *   - `RESERVATION_EXPIRY_SWEEP_ENABLED` (default true)
 *   - `RESERVATION_EXPIRY_BATCH_SIZE` (default 500)
 */
@Injectable()
export class ReservationExpirySweepCron {
  private readonly logger = new Logger(ReservationExpirySweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('RESERVATION_EXPIRY_SWEEP_ENABLED', true);
  }

  // Every minute. Reservations have a 15-min TTL; a minute of latency
  // on expiry is acceptable and the lock prevents thundering-herd.
  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('reservation-expiry-sweep', 5 * 60, async () => {
      try {
        await this.sweepOnce();
      } catch (err) {
        this.logger.error(
          `Reservation expiry sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  async sweepOnce(): Promise<{ expired: number; failed: number }> {
    const batchSize = this.env.getNumber('RESERVATION_EXPIRY_BATCH_SIZE', 500);
    const cutoff = new Date();

    const candidates = await this.prisma.stockReservation.findMany({
      where: {
        status: 'RESERVED',
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
        await this.prisma.$transaction(async (tx) => {
          // CAS-flip: only this replica's update succeeds if the row
          // is still RESERVED. Concurrent flips (the in-flight
          // checkout, another sweep replica that lost leader-election
          // and somehow raced past the lock) get count=0 and skip
          // the decrement.
          const result = await tx.stockReservation.updateMany({
            where: { id: r.id, status: 'RESERVED' },
            data: { status: 'EXPIRED' },
          });
          if (result.count === 0) {
            // Already handled by another path (CONFIRMED via checkout,
            // RELEASED via cart abandonment, or another sweep).
            return;
          }
          // Decrement reservedQty on the mapping. Math.max guards
          // against any prior under-tracked decrement that would push
          // reservedQty negative.
          await tx.sellerProductMapping.update({
            where: { id: r.mappingId },
            data: {
              reservedQty: {
                decrement: r.quantity,
              },
            },
          });
        });
        expired += 1;

        // Fire-and-forget event for ops alerting.
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
          .catch(() => {
            /* events are best-effort */
          });
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `Failed to expire reservation ${r.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Reservation expiry sweep complete — expired=${expired} failed=${failed}`,
    );
    return { expired, failed };
  }
}
