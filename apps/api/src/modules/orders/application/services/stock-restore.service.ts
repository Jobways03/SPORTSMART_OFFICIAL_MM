import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Phase 0 (PR 0.7) — symmetric stock restoration.
 *
 * The stock ledger has two parallel tables:
 *   - `SellerProductMapping.{stockQty, reservedQty}` — the seller-level
 *     view (canonical truth for allocation decisions).
 *   - `ProductVariant.stock` / `Product.baseStock` — the aggregate
 *     variant view (rendered to customers, used in admin overview).
 *
 * `SellerAllocationService.confirmReservation` decrements BOTH on
 * payment success. Three callers in the cancel/reject/reassign paths
 * historically restored only ONE side, drifting the two ledgers apart
 * permanently:
 *
 *   - `OrdersService.rejectOrder`        → incremented variant only
 *   - `OrdersService.adminCancelSubOrder` → incremented mapping only
 *   - `OrdersService.reassignSubOrder`    → incremented mapping only
 *
 * This helper is the single inverse of `confirmReservation`: given a
 * reservation id, it restores exactly what was decremented (mapping
 * AND variant/product), respecting the reservation's current state:
 *
 *   - RESERVED  → undoes the `reservedQty` bump only (stockQty / variant
 *                 were never touched; payment never confirmed)
 *   - CONFIRMED → undoes the stockQty + variant.stock decrements
 *   - RELEASED  → no-op (idempotent)
 *   - EXPIRED   → no-op (cron already swept it)
 *
 * MUST be called inside a Prisma `$transaction` so the reservation
 * status flip and the ledger updates commit atomically.
 */
@Injectable()
export class StockRestoreService {
  private readonly logger = new Logger(StockRestoreService.name);

  /**
   * Restore stock for ONE reservation. Idempotent on terminal states.
   * Returns `true` if the helper actually flipped state, `false` if it
   * was a no-op (already released, expired, or missing).
   */
  async restoreForReservation(
    tx: Prisma.TransactionClient,
    reservationId: string,
  ): Promise<boolean> {
    const reservation = await tx.stockReservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation) {
      this.logger.warn(
        `restoreForReservation: reservation ${reservationId} not found`,
      );
      return false;
    }
    if (reservation.status !== 'RESERVED' && reservation.status !== 'CONFIRMED') {
      // Already RELEASED / EXPIRED — idempotent no-op.
      return false;
    }

    // Mark RELEASED first so a concurrent caller short-circuits on the
    // status check above. The mapping/variant updates happen after; if
    // the tx rolls back we get the whole thing back.
    await tx.stockReservation.update({
      where: { id: reservationId },
      data: { status: 'RELEASED' },
    });

    if (reservation.status === 'CONFIRMED') {
      // Mirror confirmReservation's decrements (catalog/seller-allocation.service.ts):
      //   confirmReservation decremented mapping.stockQty AND
      //   mapping.reservedQty AND (variant.stock OR product.baseStock).
      // `reservedQty` was zeroed at confirm time (no rebalance needed
      // here); we only undo `stockQty` and the variant aggregate.
      const mapping = await tx.sellerProductMapping.update({
        where: { id: reservation.mappingId },
        data: { stockQty: { increment: reservation.quantity } },
      });
      if (mapping.variantId) {
        await tx.productVariant.update({
          where: { id: mapping.variantId },
          data: { stock: { increment: reservation.quantity } },
        });
      } else {
        await tx.product.update({
          where: { id: mapping.productId },
          data: { baseStock: { increment: reservation.quantity } },
        });
      }
      return true;
    }

    // RESERVED — only the hold needs to be undone. `stockQty` and
    // variant aggregate were never decremented for an unconfirmed
    // reservation, so do NOT bump them here.
    await tx.sellerProductMapping.update({
      where: { id: reservation.mappingId },
      data: { reservedQty: { decrement: reservation.quantity } },
    });
    return true;
  }

  /**
   * Convenience: restore every non-terminal reservation matching a
   * (orderId, optional sellerId) filter. Used by sub-order cancel /
   * reject / reassign paths where we don't have individual reservation
   * ids on hand.
   */
  async restoreForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    sellerId?: string,
  ): Promise<{ releasedCount: number }> {
    const reservations = await tx.stockReservation.findMany({
      where: {
        orderId,
        status: { in: ['RESERVED', 'CONFIRMED'] },
        ...(sellerId ? { mapping: { sellerId } } : {}),
      },
      select: { id: true },
    });
    let releasedCount = 0;
    for (const r of reservations) {
      const released = await this.restoreForReservation(tx, r.id);
      if (released) releasedCount++;
    }
    return { releasedCount };
  }
}
