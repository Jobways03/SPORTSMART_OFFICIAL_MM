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
   */
  async releaseStock(
    mappingId: string,
    quantity: number,
    referenceId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Decrement reserved qty (floor at 0)
      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
      });
      if (!mapping) return;

      const newReserved = Math.max(mapping.reservedQty - quantity, 0);
      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: { reservedQty: newReserved },
      });

      // Mark reservation as released
      const reservation = await tx.stockReservation.findFirst({
        where: { mappingId, orderId: referenceId, status: 'RESERVED' },
      });
      if (reservation) {
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: { status: 'RELEASED' },
        });
      }
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
