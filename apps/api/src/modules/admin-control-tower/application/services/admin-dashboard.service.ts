import { Inject, Injectable } from '@nestjs/common';
import {
  AdminControlTowerRepository,
  ADMIN_CONTROL_TOWER_REPOSITORY,
} from '../../domain/repositories/admin-control-tower.repository.interface';

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
  constructor(
    @Inject(ADMIN_CONTROL_TOWER_REPOSITORY)
    private readonly repo: AdminControlTowerRepository,
  ) {}

  // ── T1: KPIs ────────────────────────────────────────────────────────────

  async getKpis(): Promise<DashboardKpis> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalOrders,
      totalRevenue,
      totalProducts,
      totalActiveSellers,
      totalCustomers,
      ordersToday,
      revenueToday,
      pendingOrders,
      totalPlatformMargin,
    ] = await Promise.all([
      this.repo.countMasterOrders(),
      this.repo.sumPaidOrderRevenue(),
      this.repo.countActiveProducts(),
      this.repo.countActiveSellers(),
      this.repo.countUsers(),
      this.repo.countOrdersSince(todayStart),
      this.repo.sumPaidRevenueSince(todayStart),
      this.repo.countPendingSubOrders(),
      this.repo.sumPlatformMargin(),
    ]);

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

    const [topByRevenue, mostSellersMapped, lowestStock] = await Promise.all([
      this.repo.getTopProductsByRevenue(periodStart, limit),
      this.repo.getMostSellersMapped(limit),
      this.repo.getLowestStockProducts(limit),
    ]);

    return { topByRevenue, mostSellersMapped, lowestStock };
  }

  // ── T3: Seller performance ──────────────────────────────────────────────

  async getSellerPerformance(): Promise<SellerPerformanceItem[]> {
    const sellers = await this.repo.findAllSellers();
    const results: SellerPerformanceItem[] = [];

    for (const seller of sellers) {
      const [subOrderCounts, revenueResult, mappingStats] = await Promise.all([
        this.repo.getSellerSubOrderCounts(seller.id),
        this.repo.getSellerRevenue(seller.id),
        this.repo.getSellerMappingStats(seller.id),
      ]);

      const totalRevenue = revenueResult.totalSettlementAmount;
      const rejectionRate = subOrderCounts.totalSubOrders > 0
        ? Math.round((subOrderCounts.rejectedSubOrders / subOrderCounts.totalSubOrders) * 10000) / 100
        : 0;

      results.push({
        sellerId: seller.id,
        sellerName: seller.sellerName,
        sellerShopName: seller.sellerShopName,
        totalOrders: subOrderCounts.totalSubOrders,
        totalRevenue,
        avgDispatchSla: Math.round(mappingStats.avgDispatchSla * 100) / 100,
        rejectionRate,
        totalMappedProducts: mappingStats.totalMappedProducts,
        totalStock: mappingStats.totalStockQty,
        isActive: seller.status === 'ACTIVE',
      });
    }

    // Sort by totalRevenue DESC
    results.sort((a, b) => b.totalRevenue - a.totalRevenue);

    return results;
  }

  // ── T4: Allocation analytics ────────────────────────────────────────────

  async getAllocationAnalytics(): Promise<AllocationAnalytics> {
    const [totalAllocations, totalReallocations, avgMetrics] = await Promise.all([
      this.repo.countAllocations(),
      this.repo.countReallocations(),
      this.repo.getAvgAllocationMetrics(),
    ]);

    const reallocationRate = totalAllocations > 0
      ? Math.round((totalReallocations / totalAllocations) * 10000) / 100
      : 0;

    // Top allocated sellers
    const topSellersRaw = await this.repo.getTopAllocatedSellers(10);

    const sellerIds = topSellersRaw.map(s => s.sellerId);
    const sellersMap = new Map<string, string>();
    if (sellerIds.length > 0) {
      const sellers = await this.repo.findSellersByIds(sellerIds);
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
      avgDistanceKm: Math.round(avgMetrics.avgDistanceKm * 100) / 100,
      avgScore: Math.round(avgMetrics.avgScore * 10000) / 10000,
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
