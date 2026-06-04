import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  AdminControlTowerRepository,
  AdminControlTowerTxOperations,
  ProductPerformanceRow,
  SellersMappedRow,
  LowestStockRow,
  SellerBasic,
  SellerSubOrderCounts,
  SellerRevenueResult,
  SellerMappingStats,
  TopAllocatedSellerRow,
  TopAllocatedFranchiseRow,
  SellerNameEntry,
  AllocationAnalyticsFilters,
  AllocationOutcomeCountRow,
  AllocationEventsFilters,
  AllocationEventRow,
  AllocationEventsPage,
  ProductBasic,
  VariantBasic,
  SubOrderWithItems,
  SellerForValidation,
  SellerProductMappingBasic,
  StockReservationBasic,
  ProductSample,
  VariantSample,
  ActiveProductNoMappingSample,
  ReservationSample,
} from '../../domain/repositories/admin-control-tower.repository.interface';

@Injectable()
export class PrismaAdminControlTowerRepository implements AdminControlTowerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ─────────────────────────────────────────────────────────────────
   *  Dashboard (KPIs)
   * ───────────────────────────────────────────────────────────────── */

  async countMasterOrders(): Promise<number> {
    return this.prisma.masterOrder.count();
  }

  async sumPaidOrderRevenue(): Promise<number> {
    const result = await this.prisma.masterOrder.aggregate({
      _sum: { totalAmount: true },
      where: { paymentStatus: 'PAID' },
    });
    return Number(result._sum.totalAmount || 0);
  }

  async countActiveProducts(): Promise<number> {
    return this.prisma.product.count({
      where: { status: 'ACTIVE', isDeleted: false },
    });
  }

  async countActiveSellers(): Promise<number> {
    return this.prisma.seller.count({
      where: { status: 'ACTIVE', isDeleted: false },
    });
  }

  async countUsers(): Promise<number> {
    return this.prisma.user.count();
  }

  async countOrdersSince(since: Date): Promise<number> {
    return this.prisma.masterOrder.count({
      where: { createdAt: { gte: since } },
    });
  }

  async sumPaidRevenueSince(since: Date): Promise<number> {
    const result = await this.prisma.masterOrder.aggregate({
      _sum: { totalAmount: true },
      where: {
        paymentStatus: 'PAID',
        createdAt: { gte: since },
      },
    });
    return Number(result._sum.totalAmount || 0);
  }

  async countPendingSubOrders(): Promise<number> {
    return this.prisma.subOrder.count({
      where: { acceptStatus: 'OPEN' },
    });
  }

  async sumPlatformMargin(): Promise<number> {
    const result = await this.prisma.commissionRecord.aggregate({
      _sum: { platformMargin: true },
      where: { status: { not: 'REFUNDED' } },
    });
    return Number(result._sum.platformMargin || 0);
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Dashboard (product performance)
   * ───────────────────────────────────────────────────────────────── */

  async getTopProductsByRevenue(periodStart: Date, limit: number): Promise<ProductPerformanceRow[]> {
    return this.prisma.$queryRaw<ProductPerformanceRow[]>`
      SELECT
        oi.product_id AS "productId",
        p.product_code AS "productCode",
        p.title,
        COUNT(DISTINCT oi.sub_order_id)::int AS "totalOrders",
        SUM(oi.quantity)::int AS "totalQuantitySold",
        SUM(oi.total_price)::float AS "totalRevenue",
        COALESCE(SUM(cr.platform_margin), 0)::float AS "totalMargin"
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN sub_orders so ON so.id = oi.sub_order_id
      LEFT JOIN commission_records cr ON cr.order_item_id = oi.id AND cr.status != 'REFUNDED'
      WHERE so.created_at >= ${periodStart}
      GROUP BY oi.product_id, p.product_code, p.title
      ORDER BY "totalRevenue" DESC
      LIMIT ${limit}
    `;
  }

  async getMostSellersMapped(limit: number): Promise<SellersMappedRow[]> {
    return this.prisma.$queryRaw<SellersMappedRow[]>`
      SELECT
        spm.product_id AS "productId",
        p.product_code AS "productCode",
        p.title,
        COUNT(DISTINCT spm.seller_id)::int AS "sellerCount"
      FROM seller_product_mappings spm
      JOIN products p ON p.id = spm.product_id
      WHERE spm.is_active = true AND p.is_deleted = false
      GROUP BY spm.product_id, p.product_code, p.title
      ORDER BY "sellerCount" DESC
      LIMIT ${limit}
    `;
  }

  async getLowestStockProducts(limit: number): Promise<LowestStockRow[]> {
    return this.prisma.$queryRaw<LowestStockRow[]>`
      SELECT
        spm.product_id AS "productId",
        p.product_code AS "productCode",
        p.title,
        SUM(spm.stock_qty - spm.reserved_qty)::int AS "totalStock"
      FROM seller_product_mappings spm
      JOIN products p ON p.id = spm.product_id
      WHERE spm.is_active = true AND p.is_deleted = false AND p.status = 'ACTIVE'
      GROUP BY spm.product_id, p.product_code, p.title
      ORDER BY "totalStock" ASC
      LIMIT ${limit}
    `;
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Dashboard (seller performance)
   * ───────────────────────────────────────────────────────────────── */

  async findAllSellers(): Promise<SellerBasic[]> {
    const sellers = await this.prisma.seller.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        status: true,
      },
    });
    return sellers;
  }

  async getSellerSubOrderCounts(sellerId: string): Promise<SellerSubOrderCounts> {
    const [totalSubOrders, rejectedSubOrders] = await Promise.all([
      this.prisma.subOrder.count({ where: { sellerId } }),
      this.prisma.subOrder.count({ where: { sellerId, acceptStatus: 'REJECTED' } }),
    ]);
    return { totalSubOrders, rejectedSubOrders };
  }

  async getSellerRevenue(sellerId: string): Promise<SellerRevenueResult> {
    const result = await this.prisma.sellerSettlement.aggregate({
      _sum: { totalSettlementAmount: true },
      where: { sellerId },
    });
    return { totalSettlementAmount: Number(result._sum.totalSettlementAmount || 0) };
  }

  async getSellerMappingStats(sellerId: string): Promise<SellerMappingStats> {
    const [totalMappedProducts, totalStockResult, avgDispatchSlaResult] = await Promise.all([
      this.prisma.sellerProductMapping.count({
        where: { sellerId, isActive: true },
      }),
      this.prisma.sellerProductMapping.aggregate({
        _sum: { stockQty: true },
        where: { sellerId, isActive: true },
      }),
      this.prisma.sellerProductMapping.aggregate({
        _avg: { dispatchSla: true },
        where: { sellerId, isActive: true },
      }),
    ]);

    return {
      totalMappedProducts,
      totalStockQty: Number(totalStockResult._sum.stockQty || 0),
      avgDispatchSla: Number(avgDispatchSlaResult._avg.dispatchSla || 0),
    };
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Dashboard (allocation analytics)
   *
   *  Phase 233 (audit #233). Pre-233 these aggregates counted EVERY
   *  allocation_logs row, so admin-browse (LISTING), routing dry-runs
   *  (PREVIEW) and cart serviceability checks (STOREFRONT) inflated the
   *  totals — a "real routing decision" is only LIVE / REALLOCATION /
   *  MANUAL_REASSIGNMENT. That exclusion is now applied to every
   *  aggregate via `realRoutingFilters()`, on top of the operator's
   *  optional createdAt-range + node-type filters. The Prisma.Sql
   *  fragments are parameterised (no string interpolation), so the
   *  filters are injection-safe.
   * ───────────────────────────────────────────────────────────────── */

  /**
   * The always-on real-routing exclusion plus any operator filters,
   * as an array of AND-able SQL fragments. `al` is the alias the raw
   * queries below bind `allocation_logs` to.
   */
  private realRoutingFilters(
    filters?: AllocationAnalyticsFilters,
  ): Prisma.Sql[] {
    const conds: Prisma.Sql[] = [
      // Real routing decisions only — preview/listing/storefront noise
      // is kept for forensics but never counts in business metrics.
      Prisma.sql`al.event_source IN ('LIVE', 'REALLOCATION', 'MANUAL_REASSIGNMENT')`,
    ];
    if (filters?.fromDate) {
      conds.push(Prisma.sql`al.created_at >= ${filters.fromDate}`);
    }
    if (filters?.toDate) {
      conds.push(Prisma.sql`al.created_at <= ${filters.toDate}`);
    }
    if (filters?.nodeType) {
      conds.push(Prisma.sql`al.allocated_node_type = ${filters.nodeType}`);
    }
    return conds;
  }

  async countAllocations(filters?: AllocationAnalyticsFilters): Promise<number> {
    const where = Prisma.join(this.realRoutingFilters(filters), ' AND ');
    const rows = await this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM allocation_logs al
      WHERE ${where}
    `);
    return rows[0]?.count ?? 0;
  }

  async countReallocations(
    filters?: AllocationAnalyticsFilters,
  ): Promise<number> {
    const conds = this.realRoutingFilters(filters);
    conds.push(Prisma.sql`al.is_reallocated = true`);
    const where = Prisma.join(conds, ' AND ');
    const rows = await this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM allocation_logs al
      WHERE ${where}
    `);
    return rows[0]?.count ?? 0;
  }

  async getAvgAllocationMetrics(
    filters?: AllocationAnalyticsFilters,
  ): Promise<{ avgDistanceKm: number; avgScore: number }> {
    const where = Prisma.join(this.realRoutingFilters(filters), ' AND ');
    const rows = await this.prisma.$queryRaw<
      { avgDistanceKm: number | null; avgScore: number | null }[]
    >(Prisma.sql`
      SELECT
        AVG(al.distance_km)::float AS "avgDistanceKm",
        AVG(al.score)::float       AS "avgScore"
      FROM allocation_logs al
      WHERE ${where}
    `);
    return {
      avgDistanceKm: Number(rows[0]?.avgDistanceKm || 0),
      avgScore: Number(rows[0]?.avgScore || 0),
    };
  }

  async getOutcomeCounts(
    filters?: AllocationAnalyticsFilters,
  ): Promise<AllocationOutcomeCountRow[]> {
    const where = Prisma.join(this.realRoutingFilters(filters), ' AND ');
    return this.prisma.$queryRaw<AllocationOutcomeCountRow[]>(Prisma.sql`
      SELECT
        al.outcome::text AS "outcome",
        COUNT(*)::int    AS "count"
      FROM allocation_logs al
      WHERE ${where}
      GROUP BY al.outcome
    `);
  }

  async getTopAllocatedSellers(
    limit: number,
    filters?: AllocationAnalyticsFilters,
  ): Promise<TopAllocatedSellerRow[]> {
    const conds = this.realRoutingFilters(filters);
    conds.push(Prisma.sql`al.allocated_seller_id IS NOT NULL`);
    const where = Prisma.join(conds, ' AND ');
    return this.prisma.$queryRaw<TopAllocatedSellerRow[]>(Prisma.sql`
      SELECT
        al.allocated_seller_id AS "sellerId",
        COUNT(*)::int AS "allocationCount"
      FROM allocation_logs al
      WHERE ${where}
      GROUP BY al.allocated_seller_id
      ORDER BY "allocationCount" DESC
      LIMIT ${limit}
    `);
  }

  async getTopAllocatedFranchises(
    limit: number,
    filters?: AllocationAnalyticsFilters,
  ): Promise<TopAllocatedFranchiseRow[]> {
    // Symmetric to getTopAllocatedSellers but on allocated_franchise_id.
    // Franchise display name comes from franchise_partners.business_name
    // (falling back to owner_name), resolved in the same query so the
    // service doesn't need a second round-trip the way sellers do.
    const conds = this.realRoutingFilters(filters);
    conds.push(Prisma.sql`al.allocated_franchise_id IS NOT NULL`);
    const where = Prisma.join(conds, ' AND ');
    return this.prisma.$queryRaw<TopAllocatedFranchiseRow[]>(Prisma.sql`
      SELECT
        al.allocated_franchise_id AS "franchiseId",
        COALESCE(fp.business_name, fp.owner_name, 'Unknown') AS "franchiseName",
        COUNT(*)::int AS "allocationCount"
      FROM allocation_logs al
      LEFT JOIN franchise_partners fp ON fp.id = al.allocated_franchise_id
      WHERE ${where}
      GROUP BY al.allocated_franchise_id, fp.business_name, fp.owner_name
      ORDER BY "allocationCount" DESC
      LIMIT ${limit}
    `);
  }

  async findSellersByIds(ids: string[]): Promise<SellerNameEntry[]> {
    if (ids.length === 0) return [];
    return this.prisma.seller.findMany({
      where: { id: { in: ids } },
      select: { id: true, sellerName: true, sellerShopName: true },
    });
  }

  async countExceptionQueueOrders(): Promise<number> {
    return this.prisma.masterOrder.count({
      where: { orderStatus: 'EXCEPTION_QUEUE' },
    });
  }

  async getAllocationEvents(
    filters: AllocationEventsFilters,
  ): Promise<AllocationEventsPage> {
    // Drill-down behind the dashboard counters. Defaults to the real-
    // routing subset (so it lines up with the totals) but lets the
    // operator pin a specific eventSource — including the excluded
    // PREVIEW/LISTING/STOREFRONT rows — for forensic inspection.
    const conds: Prisma.Sql[] = [];
    if (filters.eventSource) {
      conds.push(Prisma.sql`al.event_source = ${filters.eventSource}::"AllocationEventSource"`);
    } else {
      conds.push(
        Prisma.sql`al.event_source IN ('LIVE', 'REALLOCATION', 'MANUAL_REASSIGNMENT')`,
      );
    }
    if (filters.outcome) {
      conds.push(Prisma.sql`al.outcome = ${filters.outcome}::"AllocationOutcome"`);
    }
    if (filters.fromDate) {
      conds.push(Prisma.sql`al.created_at >= ${filters.fromDate}`);
    }
    if (filters.toDate) {
      conds.push(Prisma.sql`al.created_at <= ${filters.toDate}`);
    }
    if (filters.nodeType) {
      conds.push(Prisma.sql`al.allocated_node_type = ${filters.nodeType}`);
    }
    const where = Prisma.join(conds, ' AND ');

    const page = Math.max(1, filters.page);
    const limit = Math.min(100, Math.max(1, filters.limit));
    const offset = (page - 1) * limit;

    const [rows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<AllocationEventRow[]>(Prisma.sql`
        SELECT
          al.id                       AS "id",
          al.product_id               AS "productId",
          al.variant_id               AS "variantId",
          al.customer_pincode         AS "customerPincode",
          al.allocated_node_type      AS "allocatedNodeType",
          al.allocated_seller_id      AS "allocatedSellerId",
          al.allocated_franchise_id   AS "allocatedFranchiseId",
          al.allocation_reason        AS "allocationReason",
          al.event_source::text       AS "eventSource",
          al.outcome::text            AS "outcome",
          al.reason_code::text        AS "reasonCode",
          al.distance_km::float       AS "distanceKm",
          al.score::float             AS "score",
          al.is_reallocated           AS "isReallocated",
          al.order_id                 AS "orderId",
          al.created_at               AS "createdAt"
        FROM allocation_logs al
        WHERE ${where}
        ORDER BY al.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM allocation_logs al
        WHERE ${where}
      `),
    ]);

    return {
      rows,
      total: totalRows[0]?.count ?? 0,
      page,
      limit,
    };
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Operations (bulk pricing)
   * ───────────────────────────────────────────────────────────────── */

  async findProductById(productId: string): Promise<ProductBasic | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isDeleted: true },
    });
  }

  async updateProductPrice(productId: string, price: number): Promise<void> {
    // Bulk pricing now writes to basePrice (the canonical customer-
    // facing price after the platformPrice column was removed).
    await this.prisma.product.update({
      where: { id: productId },
      data: { basePrice: price },
    });
  }

  async findVariantForProduct(variantId: string, productId: string): Promise<VariantBasic | null> {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
      select: { id: true },
    });
  }

  async updateVariantPrice(variantId: string, price: number): Promise<void> {
    // Bulk pricing now writes to `price` (variant's canonical
    // customer-facing price).
    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { price },
    });
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Operations (reassignment)
   * ───────────────────────────────────────────────────────────────── */

  async findSubOrderWithItems(subOrderId: string): Promise<SubOrderWithItems | null> {
    const result = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        items: true,
        masterOrder: { select: { id: true, orderNumber: true } },
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      sellerId: result.sellerId || '',
      masterOrderId: result.masterOrderId,
      acceptStatus: result.acceptStatus,
      items: result.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
      masterOrder: { id: result.masterOrder.id, orderNumber: result.masterOrder.orderNumber },
    };
  }

  async findSellerById(sellerId: string): Promise<SellerForValidation | null> {
    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, status: true, sellerName: true },
    });
  }

  async findActiveSellerMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<SellerProductMappingBasic | null> {
    const result = await this.prisma.sellerProductMapping.findFirst({
      where: {
        sellerId,
        productId,
        variantId,
        isActive: true,
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      sellerId: result.sellerId,
      productId: result.productId,
      variantId: result.variantId,
      stockQty: result.stockQty,
      reservedQty: result.reservedQty,
      isActive: result.isActive,
    };
  }

  async executeReassignment(
    callback: (tx: AdminControlTowerTxOperations) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (prismaClient) => {
      const txOps: AdminControlTowerTxOperations = {
        async findReservationsForRelease(orderId, sellerId) {
          const reservations = await prismaClient.stockReservation.findMany({
            where: {
              orderId,
              status: { in: ['RESERVED', 'CONFIRMED'] },
              mapping: { sellerId },
            },
          });
          return reservations.map((r) => ({
            id: r.id,
            mappingId: r.mappingId,
            quantity: r.quantity,
            status: r.status,
          }));
        },

        async releaseReservation(reservationId, mappingId, quantity) {
          await prismaClient.stockReservation.update({
            where: { id: reservationId },
            data: { status: 'RELEASED' },
          });
          await prismaClient.sellerProductMapping.update({
            where: { id: mappingId },
            data: { reservedQty: { decrement: quantity } },
          });
        },

        async createConfirmedReservation(mappingId, quantity, orderId) {
          await prismaClient.stockReservation.create({
            data: {
              mappingId,
              quantity,
              status: 'CONFIRMED',
              orderId,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });
        },

        async incrementMappingReservedQty(mappingId, quantity) {
          await prismaClient.sellerProductMapping.update({
            where: { id: mappingId },
            data: { reservedQty: { increment: quantity } },
          });
        },

        async updateSubOrderSeller(subOrderId, newSellerId) {
          await prismaClient.subOrder.update({
            where: { id: subOrderId },
            data: { sellerId: newSellerId },
          });
        },

        async createAllocationLog(data) {
          await prismaClient.allocationLog.create({ data });
        },

        async findSellerMapping(sellerId, productId, variantId) {
          const result = await prismaClient.sellerProductMapping.findFirst({
            where: {
              sellerId,
              productId,
              variantId,
              isActive: true,
            },
          });
          if (!result) return null;
          return {
            id: result.id,
            sellerId: result.sellerId,
            productId: result.productId,
            variantId: result.variantId,
            stockQty: result.stockQty,
            reservedQty: result.reservedQty,
            isActive: result.isActive,
          };
        },
      };

      await callback(txOps);
    });
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Operations (mapping suspension)
   * ───────────────────────────────────────────────────────────────── */

  async findSellerBasic(
    sellerId: string,
  ): Promise<{ id: string; sellerName: string; isDeleted: boolean; status: string } | null> {
    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, sellerName: true, isDeleted: true, status: true },
    });
  }

  async suspendSellerMappings(
    sellerId: string,
    adminId: string,
    reason: string,
  ): Promise<{ count: number; affectedMappingIds: string[] }> {
    // Phase 59 (2026-05-22) — status-conditional bulk suspend
    // (audit Gaps #1 + #2 + #3). Pre-Phase-59 this was a blind
    // `updateMany WHERE sellerId AND isActive=true`, conflating
    // every reason a mapping might be inactive. The new path
    // only touches mappings currently APPROVED + active, stamps
    // who/when/why, and returns the affected ids so the caller
    // can release reservations + emit per-row events.
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.sellerProductMapping.findMany({
        where: { sellerId, approvalStatus: 'APPROVED', isActive: true },
        select: { id: true },
      });
      if (candidates.length === 0) {
        return { count: 0, affectedMappingIds: [] };
      }
      const ids = candidates.map((c) => c.id);
      const result = await tx.sellerProductMapping.updateMany({
        where: {
          id: { in: ids },
          approvalStatus: 'APPROVED',
          isActive: true,
        },
        data: {
          approvalStatus: 'SUSPENDED',
          isActive: false,
          suspendedBy: adminId,
          suspendedAt: new Date(),
          suspensionReason: reason,
          // Clear stale reactivation stamps from a prior cycle so
          // the row reads as "currently suspended" not "currently
          // reactivated then re-suspended later".
          reactivatedBy: null,
          reactivatedAt: null,
          reactivationReason: null,
        },
      });
      return { count: result.count, affectedMappingIds: ids };
    });
  }

  async activateSellerMappings(
    sellerId: string,
    adminId: string,
    reason: string,
  ): Promise<{ count: number; affectedMappingIds: string[] }> {
    // Phase 59 — symmetric reverse. Only lifts mappings that were
    // bulk-suspended (approvalStatus='SUSPENDED' + isActive=false).
    // STOPPED / REJECTED / PENDING_APPROVAL rows are untouched —
    // a stopped mapping requires the explicit /reapprove path
    // (Phase 57), a rejected mapping requires seller resubmit
    // (Phase 56), and a pending mapping requires the per-mapping
    // /approve flow.
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.sellerProductMapping.findMany({
        where: { sellerId, approvalStatus: 'SUSPENDED', isActive: false },
        select: { id: true },
      });
      if (candidates.length === 0) {
        return { count: 0, affectedMappingIds: [] };
      }
      const ids = candidates.map((c) => c.id);
      const result = await tx.sellerProductMapping.updateMany({
        where: {
          id: { in: ids },
          approvalStatus: 'SUSPENDED',
          isActive: false,
        },
        data: {
          approvalStatus: 'APPROVED',
          isActive: true,
          reactivatedBy: adminId,
          reactivatedAt: new Date(),
          reactivationReason: reason,
        },
      });
      return { count: result.count, affectedMappingIds: ids };
    });
  }

  async releaseReservationsForMappings(
    mappingIds: string[],
  ): Promise<Array<{
    reservationId: string;
    mappingId: string;
    quantity: number;
    orderId: string | null;
    customerId: string | null;
    sessionId: string | null;
    cartId: string | null;
    stockQty: number;
    beforeReservedQty: number;
    afterReservedQty: number;
  }>> {
    // Phase 59 (2026-05-22) — releases active reservations on
    // suspended mappings (audit Gap #6). Per-row CAS flip pattern
    // matches Phase 58's seller-side helper + the
    // reservation-expiry sweep so a concurrent expiry doesn't
    // double-decrement reservedQty.
    if (mappingIds.length === 0) return [];
    const reservations = await this.prisma.stockReservation.findMany({
      where: { mappingId: { in: mappingIds }, status: 'RESERVED' },
      select: {
        id: true,
        mappingId: true,
        quantity: true,
        orderId: true,
        customerId: true,
        sessionId: true,
        cartId: true,
      },
    });
    if (reservations.length === 0) return [];

    const out: Array<{
      reservationId: string;
      mappingId: string;
      quantity: number;
      orderId: string | null;
      customerId: string | null;
      sessionId: string | null;
      cartId: string | null;
      stockQty: number;
      beforeReservedQty: number;
      afterReservedQty: number;
    }> = [];

    for (const r of reservations) {
      const result = await this.prisma.$transaction(async (tx) => {
        const flip = await tx.stockReservation.updateMany({
          where: { id: r.id, status: 'RESERVED' },
          data: { status: 'RELEASED', releasedAt: new Date() },
        });
        if (flip.count === 0) return null;
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
          beforeReservedQty: mappingBefore.reservedQty,
          afterReservedQty: newReserved,
          stockQty: mappingBefore.stockQty,
        };
      });
      if (result) {
        out.push({
          reservationId: r.id,
          mappingId: r.mappingId,
          quantity: r.quantity,
          orderId: r.orderId,
          customerId: r.customerId,
          sessionId: r.sessionId,
          cartId: r.cartId,
          stockQty: result.stockQty,
          beforeReservedQty: result.beforeReservedQty,
          afterReservedQty: result.afterReservedQty,
        });
      }
    }
    return out;
  }

  /* ─────────────────────────────────────────────────────────────────
   *  Data validation
   * ───────────────────────────────────────────────────────────────── */

  async countProductsWithoutCode(): Promise<number> {
    return this.prisma.product.count({
      where: { productCode: null, isDeleted: false },
    });
  }

  async sampleProductsWithoutCode(take: number): Promise<ProductSample[]> {
    return this.prisma.product.findMany({
      where: { productCode: null, isDeleted: false },
      select: { id: true, title: true, sellerId: true, createdAt: true },
      take,
    });
  }

  async countVariantsWithoutMasterSku(): Promise<number> {
    return this.prisma.productVariant.count({
      where: { masterSku: null, isDeleted: false },
    });
  }

  async sampleVariantsWithoutMasterSku(take: number): Promise<VariantSample[]> {
    return this.prisma.productVariant.findMany({
      where: { masterSku: null, isDeleted: false },
      select: { id: true, productId: true, sku: true, title: true, createdAt: true },
      take,
    });
  }

  async countActiveProductsNoMappings(): Promise<number> {
    return this.prisma.product.count({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        sellerMappings: { none: {} },
      },
    });
  }

  async sampleActiveProductsNoMappings(take: number): Promise<ActiveProductNoMappingSample[]> {
    return this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        sellerMappings: { none: {} },
      },
      select: { id: true, title: true, productCode: true, sellerId: true, createdAt: true },
      take,
    });
  }

  async countMappingsWithDeletedProducts(): Promise<number> {
    return this.prisma.sellerProductMapping.count({
      where: { product: { isDeleted: true } },
    });
  }

  async countMappingsWithDeletedVariants(): Promise<number> {
    return this.prisma.sellerProductMapping.count({
      where: { variantId: { not: null }, variant: { isDeleted: true } },
    });
  }

  async countOrderItemsReferencingDeletedProducts(): Promise<number> {
    const result = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE p.is_deleted = true
    `;
    return result[0]?.count ?? 0;
  }

  async countOrphanedCommissionRecords(): Promise<number> {
    const result = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM commission_records cr
      LEFT JOIN master_orders mo ON mo.id = cr.master_order_id
      WHERE mo.id IS NULL
    `;
    return result[0]?.count ?? 0;
  }

  async countOrphanedReservations(): Promise<number> {
    return this.prisma.stockReservation.count({
      where: { status: 'RESERVED', expiresAt: { lt: new Date() } },
    });
  }

  async sampleOrphanedReservations(take: number): Promise<ReservationSample[]> {
    return this.prisma.stockReservation.findMany({
      where: { status: 'RESERVED', expiresAt: { lt: new Date() } },
      select: { id: true, mappingId: true, quantity: true, expiresAt: true, createdAt: true },
      take,
      orderBy: { expiresAt: 'desc' },
    });
  }

  async countActiveProductsZeroStock(): Promise<number> {
    return this.prisma.product.count({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        sellerMappings: {
          some: { isActive: true },
          every: {
            OR: [
              { stockQty: { lte: 0 } },
              { isActive: false },
            ],
          },
        },
      },
    });
  }

  async countTotalProducts(): Promise<number> {
    return this.prisma.product.count({ where: { isDeleted: false } });
  }

  async countTotalActiveProducts(): Promise<number> {
    return this.prisma.product.count({ where: { isDeleted: false, status: 'ACTIVE' } });
  }

  async countTotalVariants(): Promise<number> {
    return this.prisma.productVariant.count({ where: { isDeleted: false } });
  }

  async countTotalMappings(): Promise<number> {
    return this.prisma.sellerProductMapping.count();
  }

  async countTotalActiveMappings(): Promise<number> {
    return this.prisma.sellerProductMapping.count({ where: { isActive: true } });
  }

  async countTotalOrders(): Promise<number> {
    return this.prisma.masterOrder.count();
  }

  async countTotalCommissionRecords(): Promise<number> {
    return this.prisma.commissionRecord.count();
  }

  async countTotalReservations(): Promise<number> {
    return this.prisma.stockReservation.count();
  }
}
