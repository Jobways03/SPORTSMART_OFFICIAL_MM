import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { INVENTORY_EVENTS } from '../../domain/events/inventory.events';
import { InsufficientStockException } from '../../domain/exceptions/insufficient-stock.exception';

@Injectable()
export class InventoryPublicFacade {
  private readonly logger = new Logger(InventoryPublicFacade.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Returns available stock (stockQty - reservedQty) for a seller-product mapping.
   */
  async checkAvailableStock(mappingId: string): Promise<number> {
    const mapping = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
      select: { stockQty: true, reservedQty: true },
    });
    if (!mapping) return 0;
    return Math.max(mapping.stockQty - mapping.reservedQty, 0);
  }

  /**
   * Reserves stock for a checkout/order. Creates a StockReservation record
   * and increments reservedQty on the mapping.
   */
  async reserveStock(
    mappingId: string,
    quantity: number,
    referenceId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
      });

      if (!mapping) {
        this.logger.warn(`Reserve failed: mapping ${mappingId} not found`);
        return false;
      }

      const available = mapping.stockQty - mapping.reservedQty;
      if (available < quantity) {
        this.logger.warn(
          `Reserve failed: mapping ${mappingId} has ${available} available, requested ${quantity}`,
        );
        return false;
      }

      // Increment reserved qty
      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: { reservedQty: { increment: quantity } },
      });

      // Create reservation record with 15-minute TTL
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await tx.stockReservation.create({
        data: {
          mappingId,
          quantity,
          status: 'RESERVED',
          orderId: referenceId,
          expiresAt,
        },
      });

      this.logger.log(
        `Reserved ${quantity} units on mapping ${mappingId} for ${referenceId}`,
      );

      this.eventBus.publish({
        eventName: INVENTORY_EVENTS.STOCK_RESERVED,
        aggregate: 'inventory',
        aggregateId: mappingId,
        payload: { mappingId, quantity, referenceId },
        occurredAt: new Date(),
      }).catch(() => {});

      return true;
    });
  }

  /**
   * Releases previously reserved stock (e.g. order cancelled, reservation expired).
   *
   * Phase 4.4 (2026-05-16) — race-safe rewrite. The previous version
   * found the reservation by filter then updated it in a separate
   * statement; two concurrent release calls could both find the same
   * RESERVED row and both decrement the mapping's reservedQty,
   * silently double-releasing. Now:
   *   1. CAS-flip the reservation status RESERVED → RELEASED (only
   *      one path succeeds; concurrent caller's updateMany returns 0).
   *   2. Decrement `reservedQty` ONLY when the CAS succeeded, using
   *      the persisted row's quantity (not the caller's, which may
   *      diverge if there's been a partial release).
   *   3. If no matching RESERVED row, this is a no-op — release is
   *      idempotent end-to-end.
   *
   * `quantity` is now informational only when a reservation row is
   * found (the row's stored quantity is the source of truth); we
   * still accept it for callers that release without a reservation
   * row (legacy paths), where it acts as the fallback decrement.
   */
  async releaseStock(
    mappingId: string,
    quantity: number,
    referenceId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Step 1: try to CAS-flip a matching reservation. Filter by
      // (mappingId, orderId, status=RESERVED) — the same predicate
      // that scoped the previous query. updateMany lets us own the
      // race outcome via the `count` return value.
      const reservation = await tx.stockReservation.findFirst({
        where: { mappingId, orderId: referenceId, status: 'RESERVED' },
        select: { id: true, quantity: true },
      });

      if (reservation) {
        const flip = await tx.stockReservation.updateMany({
          where: { id: reservation.id, status: 'RESERVED' },
          data: { status: 'RELEASED' },
        });
        if (flip.count === 0) {
          // Concurrent path already flipped it — skip the decrement.
          return;
        }
        // Decrement by the persisted reservation's quantity, not the
        // caller's argument. This guarantees consistency even when
        // a release is fired with a stale qty value.
        await tx.sellerProductMapping.update({
          where: { id: mappingId },
          data: {
            reservedQty: { decrement: reservation.quantity },
          },
        });
        return;
      }

      // Fallback: no reservation row exists (legacy path). Decrement
      // by the caller-supplied quantity, capped at 0 to defend
      // against under-tracked state.
      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
        select: { reservedQty: true },
      });
      if (!mapping) return;
      const newReserved = Math.max(mapping.reservedQty - quantity, 0);
      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: { reservedQty: newReserved },
      });
    });

    this.logger.log(
      `Released ${quantity} units on mapping ${mappingId} for ${referenceId}`,
    );

    this.eventBus.publish({
      eventName: INVENTORY_EVENTS.STOCK_RELEASED,
      aggregate: 'inventory',
      aggregateId: mappingId,
      payload: { mappingId, quantity, referenceId },
      occurredAt: new Date(),
    }).catch(() => {});
  }

  /**
   * Confirms stock deduction after order is dispatched.
   * Reduces stockQty and reservedQty, marks reservation as CONFIRMED.
   */
  async confirmDeduction(
    mappingId: string,
    quantity: number,
    referenceId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
      });
      if (!mapping) return;

      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: {
          stockQty: { decrement: quantity },
          reservedQty: Math.max(mapping.reservedQty - quantity, 0),
        },
      });

      // Mark reservation as confirmed
      const reservation = await tx.stockReservation.findFirst({
        where: { mappingId, orderId: referenceId, status: 'RESERVED' },
      });
      if (reservation) {
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: { status: 'CONFIRMED' },
        });
      }
    });

    this.logger.log(
      `Deducted ${quantity} units from mapping ${mappingId} for ${referenceId}`,
    );

    this.eventBus.publish({
      eventName: INVENTORY_EVENTS.STOCK_DEDUCTED,
      aggregate: 'inventory',
      aggregateId: mappingId,
      payload: { mappingId, quantity, referenceId },
      occurredAt: new Date(),
    }).catch(() => {});
  }

  /**
   * Returns full stock state for a seller-product mapping.
   */
  async getStockState(mappingId: string): Promise<{
    mappingId: string;
    stockQty: number;
    reservedQty: number;
    availableStock: number;
    lowStockThreshold: number;
    isLowStock: boolean;
    isOutOfStock: boolean;
  } | null> {
    const mapping = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
      select: {
        id: true,
        stockQty: true,
        reservedQty: true,
        lowStockThreshold: true,
      },
    });

    if (!mapping) return null;

    const available = Math.max(mapping.stockQty - mapping.reservedQty, 0);
    return {
      mappingId: mapping.id,
      stockQty: mapping.stockQty,
      reservedQty: mapping.reservedQty,
      availableStock: available,
      lowStockThreshold: mapping.lowStockThreshold,
      isLowStock: available > 0 && available <= mapping.lowStockThreshold,
      isOutOfStock: available <= 0,
    };
  }
}
