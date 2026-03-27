import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { Prisma } from '@prisma/client';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface DashboardKpis {
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  totalActiveSellers: number;
  totalCustomers: number;
  ordersToday: number;
  revenueToday: number;
  pendingOrders: number;
  totalPlatformMargin: number;
  avgOrderValue: number;
}

export interface ProductPerformanceItem {
  productId: string;
  productCode: string | null;
  title: string;
  totalOrders: number;
  totalQuantitySold: number;
  totalRevenue: number;
  totalMargin: number;
}

export interface ProductPerformanceResult {
  topByRevenue: ProductPerformanceItem[];
  mostSellersMapped: { productId: string; productCode: string | null; title: string; sellerCount: number }[];
  lowestStock: { productId: string; productCode: string | null; title: string; totalStock: number }[];
}

export interface SellerPerformanceItem {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  totalOrders: number;
  totalRevenue: number;
  avgDispatchSla: number;
  rejectionRate: number;
  totalMappedProducts: number;
  totalStock: number;
  isActive: boolean;
}

export interface AllocationAnalytics {
  totalAllocations: number;
  totalReallocations: number;
  reallocationRate: number;
  topAllocatedSellers: { sellerId: string; sellerName: string; allocationCount: number }[];
  avgDistanceKm: number;
  avgScore: number;
}

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ── T1: KPIs ────────────────────────────────────────────────────────────

  async getKpis(): Promise<DashboardKpis> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalOrders,
      totalRevenueResult,
      totalProducts,
      totalActiveSellers,
      totalCustomers,
      ordersToday,
      revenueTodayResult,
      pendingOrders,
      totalPlatformMarginResult,
    ] = await Promise.all([
      // totalOrders
      this.prisma.masterOrder.count(),

      // totalRevenue (paid orders)
      this.prisma.masterOrder.aggregate({
        _sum: { totalAmount: true },
        where: { paymentStatus: 'PAID' },
      }),

      // totalProducts (active)
      this.prisma.product.count({
        where: { status: 'ACTIVE', isDeleted: false },
      }),

      // totalActiveSellers
      this.prisma.seller.count({
        where: { status: 'ACTIVE', isDeleted: false },
      }),

      // totalCustomers
      this.prisma.user.count(),

      // ordersToday
      this.prisma.masterOrder.count({
        where: { createdAt: { gte: todayStart } },
      }),

      // revenueToday
      this.prisma.masterOrder.aggregate({
        _sum: { totalAmount: true },
        where: {
          paymentStatus: 'PAID',
          createdAt: { gte: todayStart },
        },
      }),

      // pendingOrders (sub_orders with acceptStatus OPEN)
      this.prisma.subOrder.count({
        where: { acceptStatus: 'OPEN' },
      }),

      // totalPlatformMargin
      this.prisma.commissionRecord.aggregate({
        _sum: { platformMargin: true },
        where: { status: { not: 'REFUNDED' } },
      }),
    ]);

    const totalRevenue = Number(totalRevenueResult._sum.totalAmount || 0);
    const revenueToday = Number(revenueTodayResult._sum.totalAmount || 0);
    const totalPlatformMargin = Number(totalPlatformMarginResult._sum.platformMargin || 0);
    const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

    return {
      totalOrders,
      totalRevenue,
      totalProducts,
      totalActiveSellers,
      totalCustomers,
      ordersToday,
      revenueToday,
      pendingOrders,
      totalPlatformMargin,
      avgOrderValue,
    };
  }

  // ── T2: Product performance ─────────────────────────────────────────────

  async getProductPerformance(period: string, limit: number): Promise<ProductPerformanceResult> {
    const periodStart = this.getPeriodStart(period);

    // Top products by revenue
    const topByRevenue = await this.prisma.$queryRaw<ProductPerformanceItem[]>`
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

    // Products with most sellers mapped
    const mostSellersMapped = await this.prisma.$queryRaw<
      { productId: string; productCode: string | null; title: string; sellerCount: number }[]
    >`
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

    // Products with lowest stock
    const lowestStock = await this.prisma.$queryRaw<
      { productId: string; productCode: string | null; title: string; totalStock: number }[]
    >`
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

    return { topByRevenue, mostSellersMapped, lowestStock };
  }

  // ── T3: Seller performance ──────────────────────────────────────────────

  async getSellerPerformance(): Promise<SellerPerformanceItem[]> {
    const sellers = await this.prisma.seller.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        status: true,
      },
    });

    const results: SellerPerformanceItem[] = [];

    for (const seller of sellers) {
      const [
        totalSubOrders,
        rejectedSubOrders,
        totalRevenueResult,
        totalMappedProducts,
        totalStockResult,
        avgDispatchSlaResult,
      ] = await Promise.all([
        // total sub-orders
        this.prisma.subOrder.count({
          where: { sellerId: seller.id },
        }),

        // rejected sub-orders
        this.prisma.subOrder.count({
          where: { sellerId: seller.id, acceptStatus: 'REJECTED' },
        }),

        // total settlement revenue
        this.prisma.sellerSettlement.aggregate({
          _sum: { totalSettlementAmount: true },
          where: { sellerId: seller.id },
        }),

        // mapped products
        this.prisma.sellerProductMapping.count({
          where: { sellerId: seller.id, isActive: true },
        }),

        // total stock
        this.prisma.sellerProductMapping.aggregate({
          _sum: { stockQty: true },
          where: { sellerId: seller.id, isActive: true },
        }),

        // avg dispatch SLA
        this.prisma.sellerProductMapping.aggregate({
          _avg: { dispatchSla: true },
          where: { sellerId: seller.id, isActive: true },
        }),
      ]);

      const totalRevenue = Number(totalRevenueResult._sum.totalSettlementAmount || 0);
      const rejectionRate = totalSubOrders > 0
        ? Math.round((rejectedSubOrders / totalSubOrders) * 10000) / 100
        : 0;
      const totalStock = Number(totalStockResult._sum.stockQty || 0);
      const avgDispatchSla = Number(avgDispatchSlaResult._avg.dispatchSla || 0);

      results.push({
        sellerId: seller.id,
        sellerName: seller.sellerName,
        sellerShopName: seller.sellerShopName,
        totalOrders: totalSubOrders,
        totalRevenue,
        avgDispatchSla: Math.round(avgDispatchSla * 100) / 100,
        rejectionRate,
        totalMappedProducts,
        totalStock,
        isActive: seller.status === 'ACTIVE',
      });
    }

    // Sort by totalRevenue DESC
    results.sort((a, b) => b.totalRevenue - a.totalRevenue);

    return results;
  }

  // ── T4: Allocation analytics ────────────────────────────────────────────

  async getAllocationAnalytics(): Promise<AllocationAnalytics> {
    const [
      totalAllocations,
      totalReallocations,
      avgMetrics,
    ] = await Promise.all([
      this.prisma.allocationLog.count(),
      this.prisma.allocationLog.count({ where: { isReallocated: true } }),
      this.prisma.allocationLog.aggregate({
        _avg: { distanceKm: true, score: true },
      }),
    ]);

    const reallocationRate = totalAllocations > 0
      ? Math.round((totalReallocations / totalAllocations) * 10000) / 100
      : 0;

    // Top allocated sellers
    const topSellersRaw = await this.prisma.$queryRaw<
      { sellerId: string; allocationCount: number }[]
    >`
      SELECT
        al.allocated_seller_id AS "sellerId",
        COUNT(*)::int AS "allocationCount"
      FROM allocation_logs al
      WHERE al.allocated_seller_id IS NOT NULL
      GROUP BY al.allocated_seller_id
      ORDER BY "allocationCount" DESC
      LIMIT 10
    `;

    // Enrich with seller names
    const sellerIds = topSellersRaw.map(s => s.sellerId);
    const sellersMap = new Map<string, string>();
    if (sellerIds.length > 0) {
      const sellers = await this.prisma.seller.findMany({
        where: { id: { in: sellerIds } },
        select: { id: true, sellerName: true, sellerShopName: true },
      });
      for (const s of sellers) {
        sellersMap.set(s.id, s.sellerShopName || s.sellerName);
      }
    }

    const topAllocatedSellers = topSellersRaw.map(s => ({
      sellerId: s.sellerId,
      sellerName: sellersMap.get(s.sellerId) || 'Unknown',
      allocationCount: s.allocationCount,
    }));

    return {
      totalAllocations,
      totalReallocations,
      reallocationRate,
      topAllocatedSellers,
      avgDistanceKm: Math.round(Number(avgMetrics._avg.distanceKm || 0) * 100) / 100,
      avgScore: Math.round(Number(avgMetrics._avg.score || 0) * 10000) / 10000,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private getPeriodStart(period: string): Date {
    const now = new Date();
    switch (period) {
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }
}
