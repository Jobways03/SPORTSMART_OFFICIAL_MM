import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface AllocatedSeller {
  sellerId: string;
  sellerName: string;
  mappingId: string;
  distanceKm: number;
  dispatchSla: number;
  availableStock: number;
  estimatedDeliveryDays: number;
  score: number;
}

export interface AllocationResult {
  serviceable: boolean;
  primary: AllocatedSeller | null;
  secondary: AllocatedSeller | null;
  tertiary: AllocatedSeller | null;
  allEligible: AllocatedSeller[];
}

export interface StockReservationResult {
  id: string;
  mappingId: string;
  quantity: number;
  status: string;
  orderId: string | null;
  expiresAt: Date;
}

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class SellerAllocationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SellerAllocationService.name);
  private expiryInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────

  onModuleInit() {
    // Run expired-reservation cleanup every 60 seconds
    this.expiryInterval = setInterval(async () => {
      try {
        const count = await this.releaseExpiredReservations();
        if (count > 0) {
          this.logger.log(`Released ${count} expired stock reservation(s)`);
        }
      } catch (err) {
        this.logger.error(
          `Error releasing expired reservations: ${err instanceof Error ? err.message : err}`,
        );
      }
    }, 60_000);
    this.logger.log('Stock reservation expiry job started (every 60s)');
  }

  onModuleDestroy() {
    if (this.expiryInterval) {
      clearInterval(this.expiryInterval);
      this.expiryInterval = null;
    }
  }

  // ── T1-T2  Core allocation ─────────────────────────────────────────────

  /**
   * Allocates the best seller(s) for a product/variant at a customer pincode.
   * Returns primary, secondary, and tertiary sellers.
   *
   * Ranking criteria:
   *  1. Stock availability (must have stock - reserved >= quantity)
   *  2. Shortest distance from seller pickup pincode to customer pincode (100% weight)
   */
  async allocate(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
    excludeMappingIds?: string[];
  }): Promise<AllocationResult> {
    const { productId, variantId, customerPincode, quantity, excludeMappingIds } = input;

    if (!productId) throw new BadRequestAppException('productId is required');
    if (!customerPincode) throw new BadRequestAppException('customerPincode is required');
    if (quantity < 1) throw new BadRequestAppException('quantity must be >= 1');

    // 1. Get customer pincode coordinates from PostOffice table (165K+ entries)
    const customerPostOffice = await this.prisma.postOffice.findFirst({
      where: { pincode: customerPincode, latitude: { not: null } },
      select: { latitude: true, longitude: true },
    });

    const customerLat = customerPostOffice?.latitude ? Number(customerPostOffice.latitude) : null;
    const customerLon = customerPostOffice?.longitude ? Number(customerPostOffice.longitude) : null;

    // 2. Find all active + approved seller mappings for this product/variant
    const mappingWhere: any = {
      productId,
      isActive: true,
      approvalStatus: 'APPROVED',
    };
    if (variantId) mappingWhere.variantId = variantId;
    if (excludeMappingIds && excludeMappingIds.length > 0) {
      mappingWhere.id = { notIn: excludeMappingIds };
    }

    const sellerMappings = await this.prisma.sellerProductMapping.findMany({
      where: mappingWhere,
      include: {
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            status: true,
          },
        },
      },
    });

    // Keep only ACTIVE sellers with enough available stock
    const eligible = sellerMappings.filter((m) => {
      if (m.seller.status !== 'ACTIVE') return false;
      const available = m.stockQty - m.reservedQty;
      return available >= quantity;
    });

    if (eligible.length === 0) {
      return { serviceable: false, primary: null, secondary: null, tertiary: null, allEligible: [] };
    }

    // 3. Filter by distance — seller must be within serviceable range
    const serviceable: {
      mapping: (typeof eligible)[number];
      distance: number;
    }[] = [];

    for (const mapping of eligible) {
      let distance: number | null = null;
      let sellerLat = mapping.latitude ? Number(mapping.latitude) : null;
      let sellerLon = mapping.longitude ? Number(mapping.longitude) : null;

      // If mapping has no coordinates but has pickupPincode, look up from PostOffice
      if ((sellerLat == null || sellerLon == null) && mapping.pickupPincode) {
        const sellerPO = await this.prisma.postOffice.findFirst({
          where: { pincode: mapping.pickupPincode, latitude: { not: null } },
          select: { latitude: true, longitude: true },
        });
        if (sellerPO?.latitude && sellerPO?.longitude) {
          sellerLat = Number(sellerPO.latitude);
          sellerLon = Number(sellerPO.longitude);
        }
      }

      if (customerLat && customerLon && sellerLat && sellerLon) {
        distance = this.calculateDistance(customerLat, customerLon, sellerLat, sellerLon);
      }

      // If seller has coordinates → check distance; if no coordinates → allow (assume serviceable)
      if (distance !== null) {
        serviceable.push({ mapping, distance });
      } else {
        // No coordinates available — include seller but with high distance so they rank lower
        serviceable.push({ mapping, distance: 999 });
      }
    }

    if (serviceable.length === 0) {
      return { serviceable: false, primary: null, secondary: null, tertiary: null, allEligible: [] };
    }

    // 4. Score each seller — 100% shortest distance priority
    const maxDistance = Math.max(...serviceable.map((s) => s.distance), 1);

    const scored: AllocatedSeller[] = serviceable.map((s) => {
      const score = maxDistance > 0 ? 1 - s.distance / maxDistance : 1;

      return {
        sellerId: s.mapping.seller.id,
        sellerName: s.mapping.seller.sellerShopName || s.mapping.seller.sellerName,
        mappingId: s.mapping.id,
        distanceKm: Math.round(s.distance * 100) / 100,
        dispatchSla: s.mapping.dispatchSla,
        availableStock: s.mapping.stockQty - s.mapping.reservedQty,
        estimatedDeliveryDays: this.estimateDeliveryDays(s.distance, s.mapping.dispatchSla),
        score: Math.round(score * 10000) / 10000,
      };
    });

    // 5. Sort by shortest distance (ascending) — closest seller wins
    scored.sort((a, b) => a.distanceKm - b.distanceKm);

    const result: AllocationResult = {
      serviceable: true,
      primary: scored[0] ?? null,
      secondary: scored[1] ?? null,
      tertiary: scored[2] ?? null,
      allEligible: scored,
    };

    // 6. Log allocation decision (T7)
    await this.logAllocation(input, result);

    return result;
  }

  // ── T4  Stock reservation ──────────────────────────────────────────────

  async reserveStock(input: {
    mappingId: string;
    quantity: number;
    orderId?: string;
    expiresInMinutes?: number;
  }): Promise<StockReservationResult> {
    const { mappingId, quantity, orderId, expiresInMinutes = 15 } = input;

    if (quantity < 1) throw new BadRequestAppException('quantity must be >= 1');

    // Use a transaction to prevent race conditions
    return this.prisma.$transaction(async (tx) => {
      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
      });

      if (!mapping) throw new NotFoundAppException(`Mapping ${mappingId} not found`);

      const available = mapping.stockQty - mapping.reservedQty;
      if (available < quantity) {
        throw new ConflictAppException(
          `Insufficient stock: available=${available}, requested=${quantity}`,
        );
      }

      // Create reservation
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

      const reservation = await tx.stockReservation.create({
        data: {
          mappingId,
          quantity,
          status: 'RESERVED',
          orderId: orderId ?? null,
          expiresAt,
        },
      });

      // Increment reservedQty
      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: { reservedQty: { increment: quantity } },
      });

      return {
        id: reservation.id,
        mappingId: reservation.mappingId,
        quantity: reservation.quantity,
        status: reservation.status,
        orderId: reservation.orderId,
        expiresAt: reservation.expiresAt,
      };
    });
  }

  // ── T5  Reservation expiry ─────────────────────────────────────────────

  async releaseExpiredReservations(): Promise<number> {
    const now = new Date();

    // Find all expired RESERVED reservations
    const expired = await this.prisma.stockReservation.findMany({
      where: {
        status: 'RESERVED',
        expiresAt: { lt: now },
      },
    });

    if (expired.length === 0) return 0;

    // Process each expired reservation in a transaction
    for (const reservation of expired) {
      await this.prisma.$transaction(async (tx) => {
        // Update reservation status
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: { status: 'EXPIRED' },
        });

        // Decrement reservedQty
        await tx.sellerProductMapping.update({
          where: { id: reservation.mappingId },
          data: {
            reservedQty: { decrement: reservation.quantity },
          },
        });
      });
    }

    return expired.length;
  }

  /**
   * Manually release a reservation (e.g. when an order is cancelled).
   */
  async releaseReservation(reservationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation) throw new NotFoundAppException(`Reservation ${reservationId} not found`);
      if (reservation.status !== 'RESERVED') return; // already released/confirmed

      await tx.stockReservation.update({
        where: { id: reservationId },
        data: { status: 'RELEASED' },
      });

      await tx.sellerProductMapping.update({
        where: { id: reservation.mappingId },
        data: { reservedQty: { decrement: reservation.quantity } },
      });
    });
  }

  /**
   * Confirm a reservation (e.g. after payment succeeds).
   */
  async confirmReservation(reservationId: string, orderId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation) throw new NotFoundAppException(`Reservation ${reservationId} not found`);
      if (reservation.status !== 'RESERVED') {
        throw new ConflictAppException(`Reservation ${reservationId} is already ${reservation.status}`);
      }

      await tx.stockReservation.update({
        where: { id: reservationId },
        data: {
          status: 'CONFIRMED',
          orderId: orderId ?? reservation.orderId,
        },
      });

      // Deduct from actual stockQty and release reservedQty
      await tx.sellerProductMapping.update({
        where: { id: reservation.mappingId },
        data: {
          stockQty: { decrement: reservation.quantity },
          reservedQty: { decrement: reservation.quantity },
        },
      });
    });
  }

  // ── T6  Fallback re-allocation ─────────────────────────────────────────

  async reallocate(input: {
    orderId: string;
    failedMappingId: string;
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
  }): Promise<AllocationResult> {
    const { orderId, failedMappingId, productId, variantId, customerPincode, quantity } = input;

    // Release any active reservation for the failed mapping + order
    const existingReservations = await this.prisma.stockReservation.findMany({
      where: {
        mappingId: failedMappingId,
        orderId,
        status: 'RESERVED',
      },
    });

    for (const reservation of existingReservations) {
      await this.releaseReservation(reservation.id);
    }

    // Re-run allocation excluding the failed seller
    const result = await this.allocate({
      productId,
      variantId,
      customerPincode,
      quantity,
      excludeMappingIds: [failedMappingId],
    });

    // Log re-allocation
    if (result.primary) {
      await this.prisma.allocationLog.create({
        data: {
          productId,
          variantId: variantId ?? null,
          customerPincode,
          allocatedSellerId: result.primary.sellerId,
          allocatedMappingId: result.primary.mappingId,
          allocationReason: `Re-allocated from failed mapping ${failedMappingId}`,
          distanceKm: result.primary.distanceKm,
          score: result.primary.score,
          isReallocated: true,
          orderId,
        },
      });
    }

    return result;
  }

  // ── T7  Allocation audit logging ───────────────────────────────────────

  private async logAllocation(
    input: { productId: string; variantId?: string; customerPincode: string },
    result: AllocationResult,
  ): Promise<void> {
    try {
      if (result.primary) {
        await this.prisma.allocationLog.create({
          data: {
            productId: input.productId,
            variantId: input.variantId ?? null,
            customerPincode: input.customerPincode,
            allocatedSellerId: result.primary.sellerId,
            allocatedMappingId: result.primary.mappingId,
            allocationReason: 'Primary allocation — highest score',
            distanceKm: result.primary.distanceKm,
            score: result.primary.score,
            isReallocated: false,
          },
        });
      } else {
        await this.prisma.allocationLog.create({
          data: {
            productId: input.productId,
            variantId: input.variantId ?? null,
            customerPincode: input.customerPincode,
            allocationReason: 'No serviceable sellers found',
            isReallocated: false,
          },
        });
      }
    } catch (err) {
      // Logging should never break the main flow
      this.logger.error(`Failed to log allocation: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private estimateDeliveryDays(distanceKm: number, dispatchSla: number): number {
    let transitDays = 1;
    if (distanceKm > 500) transitDays = 4;
    else if (distanceKm > 200) transitDays = 3;
    else if (distanceKm > 50) transitDays = 2;
    return dispatchSla + transitDays;
  }
}
