import { Injectable } from '@nestjs/common';
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
  SellerNameEntry,
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
   * ───────────────────────────────────────────────────────────────── */

  async countAllocations(): Promise<number> {
    return this.prisma.allocationLog.count();
  }

  async countReallocations(): Promise<number> {
    return this.prisma.allocationLog.count({ where: { isReallocated: true } });
  }

  async getAvgAllocationMetrics(): Promise<{ avgDistanceKm: number; avgScore: number }> {
    const result = await this.prisma.allocationLog.aggregate({
      _avg: { distanceKm: true, score: true },
    });
    return {
      avgDistanceKm: Number(result._avg.distanceKm || 0),
      avgScore: Number(result._avg.score || 0),
    };
  }

  async getTopAllocatedSellers(limit: number): Promise<TopAllocatedSellerRow[]> {
    return this.prisma.$queryRaw<TopAllocatedSellerRow[]>`
      SELECT
        al.allocated_seller_id AS "sellerId",
        COUNT(*)::int AS "allocationCount"
      FROM allocation_logs al
      WHERE al.allocated_seller_id IS NOT NULL
      GROUP BY al.allocated_seller_id
      ORDER BY "allocationCount" DESC
      LIMIT ${limit}
    `;
  }

  async findSellersByIds(ids: string[]): Promise<SellerNameEntry[]> {
    if (ids.length === 0) return [];
    return this.prisma.seller.findMany({
      where: { id: { in: ids } },
      select: { id: true, sellerName: true, sellerShopName: true },
    });
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

  async updateProductPrice(productId: string, platformPrice: number): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: { platformPrice },
    });
  }

  async findVariantForProduct(variantId: string, productId: string): Promise<VariantBasic | null> {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
      select: { id: true },
    });
  }

  async updateVariantPrice(variantId: string, platformPrice: number): Promise<void> {
    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { platformPrice },
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

  async findSellerBasic(sellerId: string): Promise<{ id: string; sellerName: string; isDeleted: boolean } | null> {
    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, sellerName: true, isDeleted: true },
    });
  }

  async suspendSellerMappings(sellerId: string): Promise<number> {
    const result = await this.prisma.sellerProductMapping.updateMany({
      where: { sellerId, isActive: true },
      data: { isActive: false },
    });
    return result.count;
  }

  async activateSellerMappings(sellerId: string): Promise<number> {
    const result = await this.prisma.sellerProductMapping.updateMany({
      where: { sellerId, isActive: false },
      data: { isActive: true },
    });
    return result.count;
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
