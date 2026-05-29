import { Injectable, Logger } from '@nestjs/common';
import { StockReservationStatus } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { INVENTORY_EVENTS } from '../../domain/events/inventory.events';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { StockMovementLedgerService } from '../services/stock-movement-ledger.service';

/**
 * Phase 52 (2026-05-21) — reservation lifecycle hardening.
 *
 * Architectural note on cart-add reservation policy (audit Gap #1):
 *
 *   Sportsmart's reservation model intentionally fires at CHECKOUT,
 *   not at cart-add. Industry-standard for marketplaces with seller
 *   multi-warehousing — cart-add reservations would create artificial
 *   scarcity from abandoned carts (an aggressive shopper holding 50
 *   items hostage for 15 minutes each). Stock is still race-checked
 *   at cart-add (cart.service.ts filters by stockQty - reservedQty),
 *   and the DB CHECK constraint + checkout-time re-validation are the
 *   primary oversell safeguards.
 *
 * Changes in this revision:
 *   - quantity capped at MAX_RESERVATION_QUANTITY (audit Gap #14)
 *   - reserveStock accepts attribution metadata (Gap #5)
 *   - releaseStock uses findMany + updateMany CAS so multiple
 *     RESERVED rows for one orderId all flip together (Gap #6)
 *   - confirmDeduction is now CAS-flipped: status RESERVED→CONFIRMED
 *     atomically; the mapping decrement uses the locked reservation's
 *     quantity, not the caller's stale argument (Gap #7)
 *   - StockMovement ledger row written on every reserve/release/
 *     confirm transition (Gap #9)
 *   - new extendReservation(reservationId, extraMinutes) for the
 *     bank-3DS-took-too-long recovery path (Gap #13)
 *   - new getReservation(id) for customer-side countdown rendering
 *     (Gap #10)
 *   - confirmed/released/expired stamps set on each transition
 */

export const MAX_RESERVATION_QUANTITY = 999;
export const MAX_RESERVATION_EXTENSION_MINUTES = 15;
export const MAX_TOTAL_EXTENSIONS_MINUTES = 30;
const RESERVATION_TTL_MS = 15 * 60 * 1000;

export interface ReserveStockOptions {
  /** Customer id when the reservation belongs to an authenticated session. */
  customerId?: string | null;
  /** Session id for guest checkouts. */
  sessionId?: string | null;
  /** Cart id when the reservation is cart-driven. */
  cartId?: string | null;
}

@Injectable()
export class InventoryPublicFacade {
  private readonly logger = new Logger(InventoryPublicFacade.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly ledger: StockMovementLedgerService,
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
   * Reserves stock for a checkout/order. Creates a StockReservation
   * record and increments reservedQty on the mapping inside a single
   * transaction.
   *
   * Phase 52 — accepts an options object with attribution metadata so
   * the reservation can be tied back to a customer/cart even when the
   * order row doesn't exist yet.
   */
  async reserveStock(
    mappingId: string,
    quantity: number,
    referenceId: string,
    options: ReserveStockOptions = {},
  ): Promise<boolean> {
    if (quantity <= 0) {
      throw new BadRequestAppException('quantity must be positive');
    }
    if (quantity > MAX_RESERVATION_QUANTITY) {
      throw new BadRequestAppException(
        `quantity must not exceed ${MAX_RESERVATION_QUANTITY} units per reservation`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
      });

      if (!mapping) {
        this.logger.warn(`Reserve failed: mapping ${mappingId} not found`);
        return null;
      }

      const available = mapping.stockQty - mapping.reservedQty;
      if (available < quantity) {
        this.logger.warn(
          `Reserve failed: mapping ${mappingId} has ${available} available, requested ${quantity}`,
        );
        return null;
      }

      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: { reservedQty: { increment: quantity } },
      });

      const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
      const reservation = await tx.stockReservation.create({
        data: {
          mappingId,
          quantity,
          status: StockReservationStatus.RESERVED,
          orderId: referenceId,
          customerId: options.customerId ?? null,
          sessionId: options.sessionId ?? null,
          cartId: options.cartId ?? null,
          expiresAt,
        },
      });

      return {
        reservation,
        before: { stockQty: mapping.stockQty, reservedQty: mapping.reservedQty },
        after: { stockQty: mapping.stockQty, reservedQty: mapping.reservedQty + quantity },
      };
    });

    if (!result) return false;

    await this.ledger.record({
      resource: 'SellerProductMapping',
      resourceId: mappingId,
      kind: 'RESERVED',
      quantityDelta: quantity,
      beforeStockQty: result.before.stockQty,
      afterStockQty: result.after.stockQty,
      beforeReservedQty: result.before.reservedQty,
      afterReservedQty: result.after.reservedQty,
      reason: 'Reservation created',
      referenceType: 'RESERVATION',
      referenceId: result.reservation.id,
      actorId: options.customerId ?? undefined,
      actorRole: options.customerId ? 'CUSTOMER' : 'SYSTEM',
    });

    this.logger.log(
      `Reserved ${quantity} units on mapping ${mappingId} for ${referenceId}`,
    );

    this.eventBus
      .publish({
        eventName: INVENTORY_EVENTS.STOCK_RESERVED,
        aggregate: 'inventory',
        aggregateId: mappingId,
        payload: { mappingId, quantity, referenceId, reservationId: result.reservation.id },
        occurredAt: new Date(),
      })
      .catch(() => {});

    return true;
  }

  /**
   * Releases previously reserved stock (e.g. order cancelled,
   * reservation expired via explicit cancellation).
   *
   * Phase 52 — switched from findFirst+CAS-by-id to findMany +
   * updateMany so multiple RESERVED rows for the same (mappingId,
   * orderId) — possible from checkout retries — all flip together
   * (Gap #6). The mapping reservedQty decrements by the sum of the
   * flipped rows' quantities, not the caller's argument.
   *
   * The Phase 4.4 race-safety property is preserved: the CAS-flip
   * `updateMany WHERE status=RESERVED` means a concurrent confirm
   * or expiry sweep that won the row already returns count=0 and
   * the decrement is skipped.
   *
   * Idempotent: re-calling release after the rows have already
   * flipped is a no-op.
   */
  async releaseStock(
    mappingId: string,
    quantity: number,
    referenceId: string,
  ): Promise<void> {
    const flipped = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.stockReservation.findMany({
        where: {
          mappingId,
          orderId: referenceId,
          status: StockReservationStatus.RESERVED,
        },
        select: { id: true, quantity: true },
      });

      if (candidates.length === 0) {
        // Fallback: no live reservation rows. Walk back via the
        // caller-supplied quantity for legacy paths.
        const mapping = await tx.sellerProductMapping.findUnique({
          where: { id: mappingId },
          select: { stockQty: true, reservedQty: true },
        });
        if (!mapping) return null;
        const newReserved = Math.max(mapping.reservedQty - quantity, 0);
        await tx.sellerProductMapping.update({
          where: { id: mappingId },
          data: { reservedQty: newReserved },
        });
        return {
          ids: [],
          totalQuantity: mapping.reservedQty - newReserved,
          before: { stockQty: mapping.stockQty, reservedQty: mapping.reservedQty },
          after: { stockQty: mapping.stockQty, reservedQty: newReserved },
        };
      }

      const ids = candidates.map((c) => c.id);
      const flip = await tx.stockReservation.updateMany({
        where: { id: { in: ids }, status: StockReservationStatus.RESERVED },
        data: { status: StockReservationStatus.RELEASED, releasedAt: new Date() },
      });

      if (flip.count === 0) {
        // Concurrent caller already flipped all rows — skip the decrement.
        return null;
      }

      // Only count rows we actually flipped (other rows may have
      // been claimed by the sweep cron between our findMany and
      // updateMany).
      const winning = candidates.slice(0, flip.count);
      const totalQuantity = winning.reduce((sum, c) => sum + c.quantity, 0);

      const mappingBefore = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
        select: { stockQty: true, reservedQty: true },
      });
      if (!mappingBefore) return null;
      const newReserved = Math.max(mappingBefore.reservedQty - totalQuantity, 0);
      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: { reservedQty: newReserved },
      });

      return {
        ids: winning.map((c) => c.id),
        totalQuantity,
        before: { stockQty: mappingBefore.stockQty, reservedQty: mappingBefore.reservedQty },
        after: { stockQty: mappingBefore.stockQty, reservedQty: newReserved },
      };
    });

    if (!flipped || flipped.totalQuantity === 0) return;

    await this.ledger.record({
      resource: 'SellerProductMapping',
      resourceId: mappingId,
      kind: 'RELEASED',
      quantityDelta: flipped.totalQuantity,
      beforeStockQty: flipped.before.stockQty,
      afterStockQty: flipped.after.stockQty,
      beforeReservedQty: flipped.before.reservedQty,
      afterReservedQty: flipped.after.reservedQty,
      reason: 'Reservation released',
      referenceType: 'RESERVATION',
      referenceId: flipped.ids[0] ?? referenceId,
    });

    this.logger.log(
      `Released ${flipped.totalQuantity} units on mapping ${mappingId} for ${referenceId} (${flipped.ids.length} reservation(s))`,
    );

    this.eventBus
      .publish({
        eventName: INVENTORY_EVENTS.STOCK_RELEASED,
        aggregate: 'inventory',
        aggregateId: mappingId,
        payload: { mappingId, quantity: flipped.totalQuantity, referenceId },
        occurredAt: new Date(),
      })
      .catch(() => {});
  }

  /**
   * Confirms stock deduction after order is dispatched / payment captured.
   *
   * Phase 52 (Gap #7) — now CAS-flipped. Pre-Phase-52 this read the
   * mapping then wrote stockQty + reservedQty with no atomicity vs.
   * the reservation row's status, so a concurrent expiry sweep
   * could double-decrement reservedQty (cron expires + decrements,
   * then confirm also decrements, ending up under-tracked). Now the
   * reservation flip is the first write inside the transaction:
   *
   *   1. updateMany WHERE id=… AND status=RESERVED SET status=CONFIRMED
   *      (returns count=0 if another path already finalized)
   *   2. Decrement mapping.stockQty by the locked reservation's
   *      quantity (not the caller's possibly-stale argument)
   *   3. Decrement mapping.reservedQty by the same quantity
   *
   * If count=0 we abort silently — the order's finalization is
   * idempotent and the alternate finalizer (expire/release) has
   * already handled the stock side.
   */
  async confirmDeduction(
    mappingId: string,
    quantity: number,
    referenceId: string,
  ): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findFirst({
        where: {
          mappingId,
          orderId: referenceId,
          status: StockReservationStatus.RESERVED,
        },
        select: { id: true, quantity: true },
      });
      if (!reservation) return null;

      const flip = await tx.stockReservation.updateMany({
        where: { id: reservation.id, status: StockReservationStatus.RESERVED },
        data: { status: StockReservationStatus.CONFIRMED, confirmedAt: new Date() },
      });
      if (flip.count === 0) return null;

      // Use the persisted reservation's quantity, not caller's, so
      // a stale qty argument can't corrupt counters.
      const actualQty = reservation.quantity;

      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
        select: { stockQty: true, reservedQty: true },
      });
      if (!mapping) return null;

      const newStockQty = Math.max(mapping.stockQty - actualQty, 0);
      const newReservedQty = Math.max(mapping.reservedQty - actualQty, 0);
      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: { stockQty: newStockQty, reservedQty: newReservedQty },
      });

      return {
        reservationId: reservation.id,
        quantity: actualQty,
        before: { stockQty: mapping.stockQty, reservedQty: mapping.reservedQty },
        after: { stockQty: newStockQty, reservedQty: newReservedQty },
      };
    });

    if (!result) {
      this.logger.warn(
        `Confirm skipped — no RESERVED row for mapping=${mappingId} order=${referenceId} (already finalized by expire/release)`,
      );
      return;
    }

    if (result.quantity !== quantity) {
      this.logger.warn(
        `Confirm quantity mismatch — caller requested ${quantity}, reservation row recorded ${result.quantity}; used the persisted value`,
      );
    }

    await this.ledger.record({
      resource: 'SellerProductMapping',
      resourceId: mappingId,
      kind: 'DEDUCTED',
      quantityDelta: result.quantity,
      beforeStockQty: result.before.stockQty,
      afterStockQty: result.after.stockQty,
      beforeReservedQty: result.before.reservedQty,
      afterReservedQty: result.after.reservedQty,
      reason: 'Reservation confirmed (order paid)',
      referenceType: 'RESERVATION',
      referenceId: result.reservationId,
    });

    this.logger.log(
      `Deducted ${result.quantity} units from mapping ${mappingId} for ${referenceId}`,
    );

    this.eventBus
      .publish({
        eventName: INVENTORY_EVENTS.STOCK_DEDUCTED,
        aggregate: 'inventory',
        aggregateId: mappingId,
        payload: { mappingId, quantity: result.quantity, referenceId },
        occurredAt: new Date(),
      })
      .catch(() => {});
  }

  /**
   * Phase 52 (Gap #13) — extend the TTL on a still-RESERVED row.
   *
   * Use case: customer hits 3DS at T=14:55 and the bank dialog
   * takes 5 minutes. On payment-return-to-site the storefront calls
   * this to push expiresAt forward; the cron sweep then can't
   * race the reservation while the order is finalizing.
   *
   * Capped by MAX_TOTAL_EXTENSIONS_MINUTES so a malicious client
   * can't hold stock indefinitely. We measure "total extension"
   * against the original TTL window — `expiresAt - createdAt`
   * vs `RESERVATION_TTL_MS + MAX_TOTAL_EXTENSIONS_MINUTES * 60_000`.
   */
  async extendReservation(
    reservationId: string,
    extraMinutes: number,
  ): Promise<{ expiresAt: Date }> {
    if (extraMinutes <= 0 || extraMinutes > MAX_RESERVATION_EXTENSION_MINUTES) {
      throw new BadRequestAppException(
        `extraMinutes must be between 1 and ${MAX_RESERVATION_EXTENSION_MINUTES}`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      });
      if (!reservation) {
        throw new NotFoundAppException('Reservation not found');
      }
      if (reservation.status !== StockReservationStatus.RESERVED) {
        throw new ConflictAppException(
          `Cannot extend a reservation in status ${reservation.status}`,
        );
      }
      const proposedExpiresAt = new Date(
        reservation.expiresAt.getTime() + extraMinutes * 60_000,
      );
      const maxAllowedExpiresAt = new Date(
        reservation.createdAt.getTime() +
          RESERVATION_TTL_MS +
          MAX_TOTAL_EXTENSIONS_MINUTES * 60_000,
      );
      if (proposedExpiresAt > maxAllowedExpiresAt) {
        throw new ConflictAppException(
          `Cannot extend past the maximum allowed window (${MAX_TOTAL_EXTENSIONS_MINUTES} minutes from creation)`,
        );
      }
      const updated = await tx.stockReservation.update({
        where: { id: reservationId },
        data: { expiresAt: proposedExpiresAt },
        select: { expiresAt: true },
      });
      return { expiresAt: updated.expiresAt };
    });
  }

  /**
   * Phase 52 (Gap #10) — read-only fetch for the customer countdown
   * UI. The caller (storefront) is responsible for verifying that
   * the requesting customer owns the reservation; this method only
   * returns the row.
   */
  async getReservation(reservationId: string): Promise<{
    id: string;
    mappingId: string;
    quantity: number;
    status: StockReservationStatus;
    expiresAt: Date;
    secondsRemaining: number;
    customerId: string | null;
  } | null> {
    const row = await this.prisma.stockReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        mappingId: true,
        quantity: true,
        status: true,
        expiresAt: true,
        customerId: true,
      },
    });
    if (!row) return null;
    const remainingMs = row.expiresAt.getTime() - Date.now();
    return {
      ...row,
      secondsRemaining: Math.max(0, Math.floor(remainingMs / 1000)),
    };
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
