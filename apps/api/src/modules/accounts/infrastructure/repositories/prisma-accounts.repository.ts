import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AccountsRepository } from '../../domain/repositories/accounts.repository.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class PrismaAccountsRepository implements AccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Platform-wide KPIs ─────────────────────────────────────

  async getPlatformFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }) {
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (params?.fromDate || params?.toDate) {
      dateFilter.createdAt = {};
      if (params.fromDate) dateFilter.createdAt.gte = params.fromDate;
      if (params.toDate) dateFilter.createdAt.lte = params.toDate;
    }

    const [
      sellerCommissionAgg,
      franchiseLedgerAgg,
      franchiseProcurementAgg,
      pendingSellerCount,
      pendingFranchiseCount,
      settledSellerAgg,
      settledFranchiseAgg,
      pendingSellerAgg,
      pendingFranchiseAgg,
    ] = await Promise.all([
      // Total seller commission data
      this.prisma.commissionRecord.aggregate({
        where: dateFilter,
        _sum: {
          totalPlatformAmount: true,
          totalSettlementAmount: true,
          platformMargin: true,
        },
      }),
      // Total franchise online order commission
      this.prisma.franchiseFinanceLedger.aggregate({
        where: {
          ...dateFilter,
          sourceType: 'ONLINE_ORDER',
          status: { not: 'REVERSED' },
        },
        _sum: {
          platformEarning: true,
          franchiseEarning: true,
        },
      }),
      // Total franchise procurement fees
      this.prisma.franchiseFinanceLedger.aggregate({
        where: {
          ...dateFilter,
          sourceType: 'PROCUREMENT_FEE',
          status: { not: 'REVERSED' },
        },
        _sum: {
          platformEarning: true,
        },
      }),
      // Pending seller settlements count
      this.prisma.sellerSettlement.count({
        where: { status: 'PENDING' },
      }),
      // Pending franchise settlements count
      this.prisma.franchiseSettlement.count({
        where: { status: 'PENDING' },
      }),
      // Total settled to sellers
      this.prisma.sellerSettlement.aggregate({
        where: { status: 'PAID' },
        _sum: { totalSettlementAmount: true },
      }),
      // Total settled to franchises
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PAID' },
        _sum: { netPayableToFranchise: true },
      }),
      // Pending seller payable amount
      this.prisma.sellerSettlement.aggregate({
        where: { status: 'PENDING' },
        _sum: { totalSettlementAmount: true },
      }),
      // Pending franchise payable amount
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PENDING' },
        _sum: { netPayableToFranchise: true },
      }),
    ]);

    const totalSellerCommission = Number(
      sellerCommissionAgg._sum.platformMargin || 0,
    );
    const totalFranchiseCommission = Number(
      franchiseLedgerAgg._sum.platformEarning || 0,
    );
    const totalProcurementFees = Number(
      franchiseProcurementAgg._sum.platformEarning || 0,
    );

    const totalPlatformRevenue = Number(
      sellerCommissionAgg._sum.totalPlatformAmount || 0,
    );
    const totalSellerPayables = Number(
      pendingSellerAgg._sum.totalSettlementAmount || 0,
    );
    const totalFranchisePayables = Number(
      pendingFranchiseAgg._sum.netPayableToFranchise || 0,
    );

    return {
      totalPlatformRevenue,
      totalSellerPayables,
      totalFranchisePayables,
      totalPlatformEarnings:
        totalSellerCommission + totalFranchiseCommission + totalProcurementFees,
      totalSellerCommission,
      totalFranchiseCommission,
      totalProcurementFees,
      pendingSellerSettlements: pendingSellerCount,
      pendingFranchiseSettlements: pendingFranchiseCount,
      totalSettledToSellers: Number(
        settledSellerAgg._sum.totalSettlementAmount || 0,
      ),
      totalSettledToFranchises: Number(
        settledFranchiseAgg._sum.netPayableToFranchise || 0,
      ),
    };
  }

  // ── Seller financial overview ──────────────────────────────

  async getSellerFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }) {
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (params?.fromDate || params?.toDate) {
      dateFilter.createdAt = {};
      if (params.fromDate) dateFilter.createdAt.gte = params.fromDate;
      if (params.toDate) dateFilter.createdAt.lte = params.toDate;
    }

    const [
      totalSellers,
      activeSellers,
      commissionAgg,
      totalCommissionRecords,
      pendingAgg,
      settledAgg,
    ] = await Promise.all([
      this.prisma.seller.count({ where: { isDeleted: false } }),
      this.prisma.seller.count({
        where: { isDeleted: false, status: 'ACTIVE' },
      }),
      this.prisma.commissionRecord.aggregate({
        where: dateFilter,
        _sum: {
          totalPlatformAmount: true,
          totalSettlementAmount: true,
          platformMargin: true,
        },
      }),
      this.prisma.commissionRecord.count({ where: dateFilter }),
      this.prisma.commissionRecord.aggregate({
        where: { ...dateFilter, status: 'PENDING' },
        _sum: { totalSettlementAmount: true },
      }),
      this.prisma.sellerSettlement.aggregate({
        where: { status: 'PAID' },
        _sum: { totalSettlementAmount: true },
      }),
    ]);

    return {
      totalSellers,
      activeSellers,
      totalCommissionRecords,
      totalPlatformAmount: Number(
        commissionAgg._sum.totalPlatformAmount || 0,
      ),
      totalSettlementAmount: Number(
        commissionAgg._sum.totalSettlementAmount || 0,
      ),
      totalPlatformMargin: Number(commissionAgg._sum.platformMargin || 0),
      pendingSettlementAmount: Number(
        pendingAgg._sum.totalSettlementAmount || 0,
      ),
      settledAmount: Number(settledAgg._sum.totalSettlementAmount || 0),
    };
  }

  // ── Franchise financial overview ───────────────────────────

  async getFranchiseFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }) {
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (params?.fromDate || params?.toDate) {
      dateFilter.createdAt = {};
      if (params.fromDate) dateFilter.createdAt.gte = params.fromDate;
      if (params.toDate) dateFilter.createdAt.lte = params.toDate;
    }

    const [
      totalFranchises,
      activeFranchises,
      totalLedgerEntries,
      onlineOrderAgg,
      procurementAgg,
      allLedgerAgg,
      pendingFranchiseAgg,
      settledFranchiseAgg,
    ] = await Promise.all([
      this.prisma.franchisePartner.count({ where: { isDeleted: false } }),
      this.prisma.franchisePartner.count({
        where: { isDeleted: false, status: 'ACTIVE' },
      }),
      this.prisma.franchiseFinanceLedger.count({
        where: { ...dateFilter, status: { not: 'REVERSED' } },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: {
          ...dateFilter,
          sourceType: 'ONLINE_ORDER',
          status: { not: 'REVERSED' },
        },
        _sum: { platformEarning: true },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: {
          ...dateFilter,
          sourceType: 'PROCUREMENT_FEE',
          status: { not: 'REVERSED' },
        },
        _sum: { platformEarning: true },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: {
          ...dateFilter,
          status: { not: 'REVERSED' },
        },
        _sum: { franchiseEarning: true },
      }),
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PENDING' },
        _sum: { netPayableToFranchise: true },
      }),
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PAID' },
        _sum: { netPayableToFranchise: true },
      }),
    ]);

    return {
      totalFranchises,
      activeFranchises,
      totalLedgerEntries,
      totalOnlineOrderCommission: Number(
        onlineOrderAgg._sum.platformEarning || 0,
      ),
      totalProcurementFees: Number(procurementAgg._sum.platformEarning || 0),
      totalFranchiseEarnings: Number(
        allLedgerAgg._sum.franchiseEarning || 0,
      ),
      pendingSettlementAmount: Number(
        pendingFranchiseAgg._sum.netPayableToFranchise || 0,
      ),
      settledAmount: Number(
        settledFranchiseAgg._sum.netPayableToFranchise || 0,
      ),
    };
  }

  // ── Unified payables list ──────────────────────────────────

  async getPayablesSummary(params: {
    page: number;
    limit: number;
    nodeType?: 'SELLER' | 'FRANCHISE' | 'ALL';
    status?: 'PENDING' | 'APPROVED' | 'PAID';
    search?: string;
  }) {
    const nodeType = params.nodeType || 'ALL';
    const payables: Array<{
      nodeType: 'SELLER' | 'FRANCHISE';
      nodeId: string;
      nodeName: string;
      totalOrders: number;
      totalAmount: number;
      platformEarning: number;
      pendingAmount: number;
      settledAmount: number;
      lastPaidAt: Date | null;
    }> = [];

    // Fetch seller payables
    if (nodeType === 'ALL' || nodeType === 'SELLER') {
      const sellerWhere: any = {};
      if (params.status) {
        sellerWhere.status = params.status;
      }
      if (params.search) {
        sellerWhere.sellerName = {
          contains: params.search,
          mode: 'insensitive',
        };
      }

      const sellerSettlements = await this.prisma.sellerSettlement.groupBy({
        by: ['sellerId', 'sellerName'],
        where: sellerWhere,
        _sum: {
          totalSettlementAmount: true,
          totalPlatformMargin: true,
        },
        _count: { id: true },
      });

      for (const s of sellerSettlements) {
        const [pendingAgg, paidAgg, lastPaid] = await Promise.all([
          this.prisma.sellerSettlement.aggregate({
            where: { sellerId: s.sellerId, status: 'PENDING' },
            _sum: { totalSettlementAmount: true },
          }),
          this.prisma.sellerSettlement.aggregate({
            where: { sellerId: s.sellerId, status: 'PAID' },
            _sum: { totalSettlementAmount: true },
          }),
          this.prisma.sellerSettlement.findFirst({
            where: { sellerId: s.sellerId, status: 'PAID' },
            orderBy: { paidAt: 'desc' },
            select: { paidAt: true },
          }),
        ]);

        payables.push({
          nodeType: 'SELLER',
          nodeId: s.sellerId,
          nodeName: s.sellerName,
          totalOrders: s._count.id,
          totalAmount: Number(s._sum.totalSettlementAmount || 0),
          platformEarning: Number(s._sum.totalPlatformMargin || 0),
          pendingAmount: Number(
            pendingAgg._sum.totalSettlementAmount || 0,
          ),
          settledAmount: Number(paidAgg._sum.totalSettlementAmount || 0),
          lastPaidAt: lastPaid?.paidAt || null,
        });
      }
    }

    // Fetch franchise payables
    if (nodeType === 'ALL' || nodeType === 'FRANCHISE') {
      const franchiseWhere: any = {};
      if (params.status) {
        franchiseWhere.status = params.status;
      }
      if (params.search) {
        franchiseWhere.franchiseName = {
          contains: params.search,
          mode: 'insensitive',
        };
      }

      const franchiseSettlements =
        await this.prisma.franchiseSettlement.groupBy({
          by: ['franchiseId', 'franchiseName'],
          where: franchiseWhere,
          _sum: {
            netPayableToFranchise: true,
            totalPlatformEarning: true,
            totalOnlineOrders: true,
          },
          _count: { id: true },
        });

      for (const f of franchiseSettlements) {
        const [pendingAgg, paidAgg, lastPaid] = await Promise.all([
          this.prisma.franchiseSettlement.aggregate({
            where: { franchiseId: f.franchiseId, status: 'PENDING' },
            _sum: { netPayableToFranchise: true },
          }),
          this.prisma.franchiseSettlement.aggregate({
            where: { franchiseId: f.franchiseId, status: 'PAID' },
            _sum: { netPayableToFranchise: true },
          }),
          this.prisma.franchiseSettlement.findFirst({
            where: { franchiseId: f.franchiseId, status: 'PAID' },
            orderBy: { paidAt: 'desc' },
            select: { paidAt: true },
          }),
        ]);

        payables.push({
          nodeType: 'FRANCHISE',
          nodeId: f.franchiseId,
          nodeName: f.franchiseName,
          totalOrders: f._count.id,
          totalAmount: Number(f._sum.netPayableToFranchise || 0),
          platformEarning: Number(f._sum.totalPlatformEarning || 0),
          pendingAmount: Number(
            pendingAgg._sum.netPayableToFranchise || 0,
          ),
          settledAmount: Number(
            paidAgg._sum.netPayableToFranchise || 0,
          ),
          lastPaidAt: lastPaid?.paidAt || null,
        });
      }
    }

    // Sort by pending amount descending
    payables.sort((a, b) => b.pendingAmount - a.pendingAmount);

    // Paginate
    const total = payables.length;
    const start = (params.page - 1) * params.limit;
    const paginated = payables.slice(start, start + params.limit);

    return { payables: paginated, total };
  }

  // ── Settlement cycles (unified view) ───────────────────────

  async getSettlementCycles(params: {
    page: number;
    limit: number;
    status?: string;
  }) {
    const skip = (params.page - 1) * params.limit;
    const where: any = {};
    if (params.status) {
      where.status = params.status;
    }

    const [rawCycles, total] = await Promise.all([
      this.prisma.settlementCycle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
        include: {
          sellerSettlements: {
            select: {
              totalSettlementAmount: true,
              totalPlatformMargin: true,
            },
          },
          franchiseSettlements: {
            select: {
              netPayableToFranchise: true,
              totalPlatformEarning: true,
            },
          },
          _count: {
            select: {
              sellerSettlements: true,
              franchiseSettlements: true,
            },
          },
        },
      }),
      this.prisma.settlementCycle.count({ where }),
    ]);

    const cycles = rawCycles.map((c) => {
      const totalSellerPayable = c.sellerSettlements.reduce(
        (sum, s) => sum + Number(s.totalSettlementAmount || 0),
        0,
      );
      const totalFranchisePayable = c.franchiseSettlements.reduce(
        (sum, f) => sum + Number(f.netPayableToFranchise || 0),
        0,
      );
      const sellerPlatformEarning = c.sellerSettlements.reduce(
        (sum, s) => sum + Number(s.totalPlatformMargin || 0),
        0,
      );
      const franchisePlatformEarning = c.franchiseSettlements.reduce(
        (sum, f) => sum + Number(f.totalPlatformEarning || 0),
        0,
      );

      return {
        id: c.id,
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        status: c.status,
        sellerSettlementCount: c._count.sellerSettlements,
        franchiseSettlementCount: c._count.franchiseSettlements,
        totalSellerPayable: Math.round(totalSellerPayable * 100) / 100,
        totalFranchisePayable:
          Math.round(totalFranchisePayable * 100) / 100,
        totalPlatformEarning:
          Math.round(
            (sellerPlatformEarning + franchisePlatformEarning) * 100,
          ) / 100,
        createdAt: c.createdAt,
      };
    });

    return { cycles, total };
  }

  // ── Revenue breakdown ──────────────────────────────────────

  async getRevenueBreakdown(params: {
    fromDate: Date;
    toDate: Date;
    groupBy: 'day' | 'week' | 'month';
  }) {
    const truncFn =
      params.groupBy === 'day'
        ? `date_trunc('day', mo.created_at)`
        : params.groupBy === 'week'
          ? `date_trunc('week', mo.created_at)`
          : `date_trunc('month', mo.created_at)`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        period: Date;
        total_revenue: Prisma.Decimal | null;
        seller_amount: Prisma.Decimal | null;
        franchise_amount: Prisma.Decimal | null;
      }>
    >(
      Prisma.sql`
        SELECT
          ${Prisma.raw(truncFn)} AS period,
          SUM(mo.total_amount) AS total_revenue,
          COALESCE(SUM(CASE WHEN so.fulfillment_node_type = 'SELLER' THEN so.sub_total ELSE 0 END), 0) AS seller_amount,
          COALESCE(SUM(CASE WHEN so.fulfillment_node_type = 'FRANCHISE' THEN so.sub_total ELSE 0 END), 0) AS franchise_amount
        FROM master_orders mo
        LEFT JOIN sub_orders so ON so.master_order_id = mo.id
        WHERE mo.created_at >= ${params.fromDate}
          AND mo.created_at <= ${params.toDate}
        GROUP BY period
        ORDER BY period ASC
      `,
    );

    return rows.map((r) => {
      const totalRevenue = Number(r.total_revenue || 0);
      const sellerFulfilledAmount = Number(r.seller_amount || 0);
      const franchiseFulfilledAmount = Number(r.franchise_amount || 0);

      return {
        period: r.period.toISOString(),
        totalRevenue,
        sellerFulfilledAmount,
        franchiseFulfilledAmount,
        platformEarning:
          Math.round(
            (totalRevenue - sellerFulfilledAmount - franchiseFulfilledAmount) *
              100,
          ) / 100,
      };
    });
  }

  // ── Top sellers ────────────────────────────────────────────

  async getTopSellers(limit: number, fromDate?: Date, toDate?: Date) {
    const dateFilter: any = {};
    if (fromDate || toDate) {
      dateFilter.createdAt = {};
      if (fromDate) dateFilter.createdAt.gte = fromDate;
      if (toDate) dateFilter.createdAt.lte = toDate;
    }

    const sellers = await this.prisma.commissionRecord.groupBy({
      by: ['sellerId', 'sellerName'],
      where: dateFilter,
      _sum: {
        totalPlatformAmount: true,
        platformMargin: true,
      },
      _count: { subOrderId: true },
      orderBy: { _sum: { totalPlatformAmount: 'desc' } },
      take: limit,
    });

    return sellers.map((s) => {
      const totalRevenue = Number(s._sum.totalPlatformAmount || 0);
      const platformMargin = Number(s._sum.platformMargin || 0);

      return {
        sellerId: s.sellerId,
        sellerName: s.sellerName,
        totalOrders: s._count.subOrderId,
        totalRevenue,
        platformMargin,
        marginPercentage:
          totalRevenue > 0
            ? Math.round((platformMargin / totalRevenue) * 10000) / 100
            : 0,
      };
    });
  }

  // ── Top franchises ─────────────────────────────────────────

  async getTopFranchises(limit: number, fromDate?: Date, toDate?: Date) {
    const dateFilter: any = {};
    if (fromDate || toDate) {
      dateFilter.createdAt = {};
      if (fromDate) dateFilter.createdAt.gte = fromDate;
      if (toDate) dateFilter.createdAt.lte = toDate;
    }

    const entries = await this.prisma.franchiseFinanceLedger.groupBy({
      by: ['franchiseId'],
      where: {
        ...dateFilter,
        status: { not: 'REVERSED' },
      },
      _sum: {
        baseAmount: true,
        platformEarning: true,
      },
      _count: { id: true },
      orderBy: { _sum: { baseAmount: 'desc' } },
      take: limit,
    });

    // Fetch franchise names and split online vs procurement counts
    const results = await Promise.all(
      entries.map(async (e) => {
        const [franchise, onlineCount, procurementCount] = await Promise.all([
          this.prisma.franchisePartner.findUnique({
            where: { id: e.franchiseId },
            select: { businessName: true },
          }),
          this.prisma.franchiseFinanceLedger.count({
            where: {
              franchiseId: e.franchiseId,
              sourceType: 'ONLINE_ORDER',
              status: { not: 'REVERSED' },
              ...dateFilter,
            },
          }),
          this.prisma.franchiseFinanceLedger.count({
            where: {
              franchiseId: e.franchiseId,
              sourceType: 'PROCUREMENT_FEE',
              status: { not: 'REVERSED' },
              ...dateFilter,
            },
          }),
        ]);

        return {
          franchiseId: e.franchiseId,
          franchiseName: franchise?.businessName || 'Unknown',
          totalOnlineOrders: onlineCount,
          totalProcurements: procurementCount,
          totalRevenue: Number(e._sum.baseAmount || 0),
          platformEarning: Number(e._sum.platformEarning || 0),
        };
      }),
    );

    return results;
  }

  // ── Outstanding payables ───────────────────────────────────

  async getOutstandingPayables() {
    const [sellerOutstanding, franchiseOutstanding, oldestSeller, oldestFranchise] =
      await Promise.all([
        this.prisma.sellerSettlement.aggregate({
          where: { status: 'PENDING' },
          _count: { id: true },
          _sum: { totalSettlementAmount: true },
        }),
        this.prisma.franchiseSettlement.aggregate({
          where: { status: 'PENDING' },
          _count: { id: true },
          _sum: { netPayableToFranchise: true },
        }),
        this.prisma.sellerSettlement.findFirst({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.franchiseSettlement.findFirst({
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      ]);

    const sellerAmt = Number(
      sellerOutstanding._sum.totalSettlementAmount || 0,
    );
    const franchiseAmt = Number(
      franchiseOutstanding._sum.netPayableToFranchise || 0,
    );

    // Find oldest unpaid date across both
    let oldestUnpaidDate: Date | null = null;
    if (oldestSeller?.createdAt && oldestFranchise?.createdAt) {
      oldestUnpaidDate =
        oldestSeller.createdAt < oldestFranchise.createdAt
          ? oldestSeller.createdAt
          : oldestFranchise.createdAt;
    } else {
      oldestUnpaidDate =
        oldestSeller?.createdAt || oldestFranchise?.createdAt || null;
    }

    return {
      sellerOutstanding: {
        count: sellerOutstanding._count.id,
        amount: sellerAmt,
      },
      franchiseOutstanding: {
        count: franchiseOutstanding._count.id,
        amount: franchiseAmt,
      },
      totalOutstanding: Math.round((sellerAmt + franchiseAmt) * 100) / 100,
      oldestUnpaidDate,
    };
  }
}
