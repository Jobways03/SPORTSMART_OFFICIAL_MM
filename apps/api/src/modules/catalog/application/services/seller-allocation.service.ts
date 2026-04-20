import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface AllocatedSeller {
  nodeType: 'SELLER' | 'FRANCHISE';
  sellerId: string;        // seller ID or franchise ID
  sellerName: string;      // seller name or franchise name
  franchiseId?: string;    // only set when nodeType is FRANCHISE
  mappingId: string;       // SellerProductMapping ID or FranchiseCatalogMapping ID
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

  // Scoring weights — configurable via env, cached at startup.
  private readonly wDistance: number;
  private readonly wStock: number;
  private readonly wSla: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
  ) {
    this.wDistance = this.envService.getNumber('ROUTING_DISTANCE_WEIGHT', 0.7);
    this.wStock = this.envService.getNumber('ROUTING_STOCK_WEIGHT', 0.2);
    this.wSla = this.envService.getNumber('ROUTING_SLA_WEIGHT', 0.1);
  }

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
   * Allocates the best fulfillment node(s) — sellers and/or franchises —
   * for a product/variant at a customer pincode.
   * Returns primary, secondary, and tertiary candidates.
   *
   * Ranking criteria (weighted scoring — sellers & franchises compete equally):
   *  - Distance: ROUTING_DISTANCE_WEIGHT (default 0.7, lower = better, Haversine from pincode)
   *  - Stock confidence: ROUTING_STOCK_WEIGHT (default 0.2, more stock = better)
   *  - Dispatch SLA: ROUTING_SLA_WEIGHT (default 0.1, faster = better)
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

    // Deterministic tiebreak: when two sellers end up with the same allocation
    // score, the stable sort at L#274 preserves this input order — so an
    // explicit orderBy prevents different API instances from routing the
    // same order to different sellers.
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
      orderBy: { id: 'asc' },
    });

    // Keep only ACTIVE sellers with enough available stock
    const stockEligible = sellerMappings.filter((m) => {
      if (m.seller.status !== 'ACTIVE') return false;
      const available = m.stockQty - m.reservedQty;
      return available >= quantity;
    });

    // Enforce SellerServiceArea for sellers that opted in. A seller with ANY
    // active service-area row is treated as "explicitly restricted" — the
    // customer pincode must be in their set. Sellers with no rows keep
    // distance-only behavior (backwards compatible).
    const candidateSellerIds = stockEligible.map((m) => m.sellerId);
    let optedInSellers = new Set<string>();
    let servingThisPincode = new Set<string>();
    if (candidateSellerIds.length > 0) {
      const [optedIn, serving] = await Promise.all([
        this.prisma.sellerServiceArea.findMany({
          where: {
            sellerId: { in: candidateSellerIds },
            isActive: true,
          },
          select: { sellerId: true },
          distinct: ['sellerId'],
        }),
        this.prisma.sellerServiceArea.findMany({
          where: {
            sellerId: { in: candidateSellerIds },
            pincode: customerPincode,
            isActive: true,
          },
          select: { sellerId: true },
        }),
      ]);
      optedInSellers = new Set(optedIn.map((r) => r.sellerId));
      servingThisPincode = new Set(serving.map((r) => r.sellerId));
    }
    const eligible = stockEligible.filter(
      (m) =>
        !optedInSellers.has(m.sellerId) || servingThisPincode.has(m.sellerId),
    );

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

    // 4. Build seller candidates with nodeType
    const sellerCandidates: AllocatedSeller[] = serviceable.map((s) => ({
      nodeType: 'SELLER' as const,
      sellerId: s.mapping.seller.id,
      sellerName: s.mapping.seller.sellerShopName || s.mapping.seller.sellerName,
      mappingId: s.mapping.id,
      distanceKm: Math.round(s.distance * 100) / 100,
      dispatchSla: s.mapping.dispatchSla,
      availableStock: s.mapping.stockQty - s.mapping.reservedQty,
      estimatedDeliveryDays: this.estimateDeliveryDays(s.distance, s.mapping.dispatchSla),
      score: 0, // will be scored below
    }));

    // 5. Find franchise candidates — same distance-based logic as sellers
    const franchiseCandidates = await this.findEligibleFranchises({
      productId,
      variantId,
      customerPincode,
      quantity,
      customerLat,
      customerLon,
    });

    // 6. Merge all candidates (sellers + franchises compete equally)
    const allCandidates = [
      ...sellerCandidates,
      ...franchiseCandidates,
    ];

    if (allCandidates.length === 0) {
      return { serviceable: false, primary: null, secondary: null, tertiary: null, allEligible: [] };
    }

    const maxDistance = Math.max(...allCandidates.map((c) => c.distanceKm), 1);
    const maxSla = Math.max(...allCandidates.map((c) => c.dispatchSla), 1);

    const scored: AllocatedSeller[] = allCandidates.map((candidate) => {
      let score = 0;
      // Distance score (lower distance = higher score)
      score += this.wDistance * (1 - candidate.distanceKm / maxDistance);
      // Stock confidence
      score += this.wStock * Math.min(candidate.availableStock / quantity, 1);
      // SLA score (faster dispatch = higher score)
      score += this.wSla * (1 - candidate.dispatchSla / maxSla);
      // No priority boost — sellers and franchises compete equally
      return { ...candidate, score: Math.round(score * 10000) / 10000 };
    });

    // 7. Sort by score descending — highest score wins
    scored.sort((a, b) => b.score - a.score);

    const result: AllocationResult = {
      serviceable: true,
      primary: scored[0] ?? null,
      secondary: scored[1] ?? null,
      tertiary: scored[2] ?? null,
      allEligible: scored,
    };

    // 8. Log allocation decision (T7)
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

    // Reserve inside a transaction with a row-level lock so concurrent
    // reservations against the same mapping serialize correctly.
    //
    // The race we're closing: two transactions both `findUnique`, both see
    // `available >= quantity`, both increment `reservedQty`. Without the
    // FOR UPDATE the database happily lets both commit and oversells.
    // With FOR UPDATE the second SELECT blocks until the first commits,
    // then sees the updated `reservedQty` and correctly rejects.
    return this.prisma.$transaction(async (tx) => {
      // Acquire the row lock. Postgres-only — uses raw SQL because Prisma
      // does not expose FOR UPDATE on its query builder.
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; stock_qty: number; reserved_qty: number }>
      >`
        SELECT id, stock_qty, reserved_qty
        FROM seller_product_mappings
        WHERE id = ${mappingId}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundAppException(`Mapping ${mappingId} not found`);
      }

      const available = locked.stock_qty - locked.reserved_qty;
      if (available < quantity) {
        throw new ConflictAppException(
          `Insufficient stock: available=${available}, requested=${quantity}`,
        );
      }

      // Re-fetch via the type-safe client so downstream code that expected
      // a Prisma model object still works (the locked row above only has
      // the snake_case columns we asked for).
      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
      });
      if (!mapping) {
        // Should not happen — we just locked it.
        throw new NotFoundAppException(`Mapping ${mappingId} not found`);
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
          allocatedNodeType: result.primary.nodeType,
          allocatedSellerId: result.primary.nodeType === 'SELLER' ? result.primary.sellerId : null,
          allocatedFranchiseId: result.primary.nodeType === 'FRANCHISE' ? result.primary.franchiseId : null,
          allocatedMappingId: result.primary.mappingId,
          allocationReason: `Re-allocated from failed mapping ${failedMappingId} (${result.primary.nodeType})`,
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
            allocatedNodeType: result.primary.nodeType,
            allocatedSellerId: result.primary.nodeType === 'SELLER' ? result.primary.sellerId : null,
            allocatedFranchiseId: result.primary.nodeType === 'FRANCHISE' ? result.primary.franchiseId : null,
            allocatedMappingId: result.primary.mappingId,
            allocationReason: `Primary allocation — highest score (${result.primary.nodeType})`,
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
            allocationReason: 'No serviceable sellers or franchises found',
            isReallocated: false,
          },
        });
      }
    } catch (err) {
      // Logging should never break the main flow
      this.logger.error(`Failed to log allocation: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Franchise candidate discovery ──────────────────────────────────────

  /**
   * Find eligible franchise partners for a product, using the same
   * distance-based logic as sellers. Franchises compete equally with
   * sellers — no coverage area checks, no exclusivity, no priority boost.
   *
   * A franchise is eligible when:
   *  1. FranchisePartner status is ACTIVE
   *  2. FranchiseCatalogMapping exists (approved + active + listed for online)
   *  3. FranchiseStock has enough available quantity
   *  4. Distance is calculated from franchise warehousePincode to customer pincode
   */
  private async findEligibleFranchises(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
    customerLat: number | null;
    customerLon: number | null;
  }): Promise<AllocatedSeller[]> {
    const { productId, variantId, quantity, customerLat, customerLon } = input;

    // 1. Find all approved + active catalog mappings for this product
    const catalogWhere: any = {
      productId,
      isActive: true,
      approvalStatus: 'APPROVED',
      isListedForOnlineFulfillment: true,
    };
    if (variantId) catalogWhere.variantId = variantId;

    const catalogMappings = await this.prisma.franchiseCatalogMapping.findMany({
      where: catalogWhere,
      include: {
        franchise: {
          select: {
            id: true,
            businessName: true,
            status: true,
            warehousePincode: true,
            isDeleted: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const candidates: AllocatedSeller[] = [];

    // Deduplicate by franchiseId (keep first mapping found)
    const seen = new Set<string>();

    for (const mapping of catalogMappings) {
      const franchise = mapping.franchise;

      // Skip non-active or deleted franchises
      if (franchise.status !== 'ACTIVE' || franchise.isDeleted) continue;
      if (seen.has(franchise.id)) continue;
      seen.add(franchise.id);

      // 2. Check FranchiseStock: available qty >= requested quantity
      const stockWhere: any = { franchiseId: franchise.id, productId };
      if (variantId) stockWhere.variantId = variantId;

      const stock = await this.prisma.franchiseStock.findFirst({
        where: stockWhere,
      });

      if (!stock || stock.availableQty < quantity) continue;

      // 3. Calculate distance from franchise warehouse pincode to customer pincode
      let distance = 999;
      if (customerLat && customerLon && franchise.warehousePincode) {
        const warehousePO = await this.prisma.postOffice.findFirst({
          where: { pincode: franchise.warehousePincode, latitude: { not: null } },
          select: { latitude: true, longitude: true },
        });
        if (warehousePO?.latitude && warehousePO?.longitude) {
          distance = this.calculateDistance(
            customerLat,
            customerLon,
            Number(warehousePO.latitude),
            Number(warehousePO.longitude),
          );
        }
      }

      const dispatchSla = 1; // franchise default dispatch SLA

      candidates.push({
        nodeType: 'FRANCHISE',
        sellerId: franchise.id,
        sellerName: franchise.businessName,
        franchiseId: franchise.id,
        mappingId: mapping.id,
        distanceKm: Math.round(distance * 100) / 100,
        dispatchSla,
        availableStock: stock.availableQty,
        estimatedDeliveryDays: this.estimateDeliveryDays(distance, dispatchSla),
        score: 0,
      });
    }

    return candidates;
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
