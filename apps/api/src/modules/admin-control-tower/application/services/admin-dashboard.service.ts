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
  // Phase 233 — symmetric to topAllocatedSellers but for franchise nodes.
  topAllocatedFranchises: { franchiseId: string; franchiseName: string; allocationCount: number }[];
  avgDistanceKm: number;
  avgScore: number;
  // Phase 233 — outcome counters (GROUP BY outcome over real-routing
  // rows). Field names are the exact keys the admin dashboard's
  // "Allocation health" cards read (web-admin-storefront dashboard
  // page) — do NOT rename without the frontend.
  primaryServiceableCount: number;
  fallbackUsedCount: number;
  unservicableCount: number; // intentional spelling: matches the FE card key
  reassignedCount: number;
  // Phase 233 — MasterOrders parked in EXCEPTION_QUEUE (the FE
  // "Exception queue" card). Not derived from allocation_logs.
  exceptionQueueCount: number;
}

/**
 * Phase 233 — optional filters for the allocation dashboard. All
 * aggregates additionally exclude non-real-routing rows
 * (LISTING/PREVIEW/STOREFRONT) in the repository regardless of these.
 */
export interface AllocationAnalyticsFilterInput {
  fromDate?: Date;
  toDate?: Date;
  nodeType?: string;
}

// Phase 233 — drill-down row at the format boundary: Decimal columns
// are plain numbers (or null) and createdAt is an ISO string.
export interface AllocationEventItem {
  id: string;
  productId: string;
  variantId: string | null;
  customerPincode: string;
  allocatedNodeType: string | null;
  allocatedSellerId: string | null;
  allocatedFranchiseId: string | null;
  allocationReason: string | null;
  eventSource: string;
  outcome: string | null;
  reasonCode: string | null;
  distanceKm: number | null;
  score: number | null;
  isReallocated: boolean;
  orderId: string | null;
  createdAt: string;
}

export interface AllocationEventsResult {
  events: AllocationEventItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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

  async getAllocationAnalytics(
    filters?: AllocationAnalyticsFilterInput,
  ): Promise<AllocationAnalytics> {
    const [
      totalAllocations,
      totalReallocations,
      avgMetrics,
      outcomeCounts,
      topSellersRaw,
      topFranchisesRaw,
      exceptionQueueCount,
    ] = await Promise.all([
      this.repo.countAllocations(filters),
      this.repo.countReallocations(filters),
      this.repo.getAvgAllocationMetrics(filters),
      this.repo.getOutcomeCounts(filters),
      this.repo.getTopAllocatedSellers(10, filters),
      this.repo.getTopAllocatedFranchises(10, filters),
      this.repo.countExceptionQueueOrders(),
    ]);

    const reallocationRate = totalAllocations > 0
      ? Math.round((totalReallocations / totalAllocations) * 10000) / 100
      : 0;

    // Fold the GROUP BY outcome rows into the four FE card counters.
    // Rows whose outcome is NULL (pre-233 history) simply don't land in
    // any bucket — they still count toward totalAllocations.
    const outcomeMap = new Map<string, number>();
    for (const row of outcomeCounts) {
      if (row.outcome) outcomeMap.set(row.outcome, row.count);
    }

    // Top allocated sellers — name resolved via a second lookup (seller
    // names live on a different table than the allocation log).
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

    // Franchise names are resolved inside the repo query already.
    const topAllocatedFranchises = topFranchisesRaw.map(f => ({
      franchiseId: f.franchiseId,
      franchiseName: f.franchiseName || 'Unknown',
      allocationCount: f.allocationCount,
    }));

    return {
      totalAllocations,
      totalReallocations,
      reallocationRate,
      topAllocatedSellers,
      topAllocatedFranchises,
      avgDistanceKm: Math.round(avgMetrics.avgDistanceKm * 100) / 100,
      avgScore: Math.round(avgMetrics.avgScore * 10000) / 10000,
      primaryServiceableCount: outcomeMap.get('PRIMARY_SERVICEABLE') ?? 0,
      fallbackUsedCount: outcomeMap.get('FALLBACK_SERVICEABLE') ?? 0,
      unservicableCount: outcomeMap.get('UNSERVICEABLE') ?? 0,
      reassignedCount: outcomeMap.get('REASSIGNED') ?? 0,
      exceptionQueueCount,
    };
  }

  // ── T4b: Allocation events drill-down ───────────────────────────────────

  async getAllocationEvents(input: {
    outcome?: string;
    eventSource?: string;
    fromDate?: Date;
    toDate?: Date;
    nodeType?: string;
    page?: number;
    limit?: number;
  }): Promise<AllocationEventsResult> {
    const page = input.page && input.page >= 1 ? Math.floor(input.page) : 1;
    const limit = input.limit && input.limit >= 1
      ? Math.min(100, Math.floor(input.limit))
      : 20;

    const result = await this.repo.getAllocationEvents({
      outcome: input.outcome,
      eventSource: input.eventSource,
      fromDate: input.fromDate,
      toDate: input.toDate,
      nodeType: input.nodeType,
      page,
      limit,
    });

    return {
      events: result.rows.map(r => ({
        ...r,
        // Decimal columns are surfaced as numbers (or null) at the
        // format boundary, matching the dashboard's number contract.
        distanceKm: r.distanceKm == null ? null : Number(r.distanceKm),
        score: r.score == null ? null : Number(r.score),
        // Normalise to an ISO string regardless of whether the raw
        // driver handed back a Date or a string.
        createdAt: new Date(r.createdAt).toISOString(),
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.limit > 0 ? Math.ceil(result.total / result.limit) : 0,
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
