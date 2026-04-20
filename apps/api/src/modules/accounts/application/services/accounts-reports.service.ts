import { Injectable, Inject } from '@nestjs/common';
import {
  AccountsRepository,
  ACCOUNTS_REPOSITORY,
} from '../../domain/repositories/accounts.repository.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class AccountsReportsService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepo: AccountsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getRevenueBreakdown(
    fromDate: Date,
    toDate: Date,
    groupBy: 'day' | 'week' | 'month',
  ) {
    return this.accountsRepo.getRevenueBreakdown({
      fromDate,
      toDate,
      groupBy,
    });
  }

  async getPlatformMarginReport(fromDate: Date, toDate: Date) {
    const dateFilter = {
      createdAt: { gte: fromDate, lte: toDate },
    };

    const [sellerMargins, franchiseMargins] = await Promise.all([
      // Seller margins grouped by seller
      this.prisma.commissionRecord.groupBy({
        by: ['sellerId', 'sellerName'],
        where: dateFilter,
        _sum: {
          totalPlatformAmount: true,
          totalSettlementAmount: true,
          platformMargin: true,
        },
        _count: { id: true },
        orderBy: { _sum: { platformMargin: 'desc' } },
      }),
      // Franchise margins grouped by franchise
      this.prisma.franchiseFinanceLedger.groupBy({
        by: ['franchiseId'],
        where: {
          ...dateFilter,
          status: { not: 'REVERSED' },
        },
        _sum: {
          baseAmount: true,
          platformEarning: true,
          franchiseEarning: true,
        },
        _count: { id: true },
        orderBy: { _sum: { platformEarning: 'desc' } },
      }),
    ]);

    // Fetch franchise names
    const franchiseIds = franchiseMargins.map((f) => f.franchiseId);
    const franchises =
      franchiseIds.length > 0
        ? await this.prisma.franchisePartner.findMany({
            where: { id: { in: franchiseIds } },
            select: { id: true, businessName: true },
          })
        : [];
    const franchiseNameMap = new Map(
      franchises.map((f) => [f.id, f.businessName]),
    );

    const sellerReport = sellerMargins.map((s) => ({
      nodeType: 'SELLER' as const,
      nodeId: s.sellerId,
      nodeName: s.sellerName,
      totalRecords: s._count.id,
      totalRevenue: Number(s._sum.totalPlatformAmount || 0),
      totalPayable: Number(s._sum.totalSettlementAmount || 0),
      platformMargin: Number(s._sum.platformMargin || 0),
      marginPercentage:
        Number(s._sum.totalPlatformAmount || 0) > 0
          ? Math.round(
              (Number(s._sum.platformMargin || 0) /
                Number(s._sum.totalPlatformAmount || 0)) *
                10000,
            ) / 100
          : 0,
    }));

    const franchiseReport = franchiseMargins.map((f) => ({
      nodeType: 'FRANCHISE' as const,
      nodeId: f.franchiseId,
      nodeName: franchiseNameMap.get(f.franchiseId) || 'Unknown',
      totalRecords: f._count.id,
      totalRevenue: Number(f._sum.baseAmount || 0),
      totalPayable: Number(f._sum.franchiseEarning || 0),
      platformMargin: Number(f._sum.platformEarning || 0),
      marginPercentage:
        Number(f._sum.baseAmount || 0) > 0
          ? Math.round(
              (Number(f._sum.platformEarning || 0) /
                Number(f._sum.baseAmount || 0)) *
                10000,
            ) / 100
          : 0,
    }));

    const totalSellerMargin = sellerReport.reduce(
      (sum, s) => sum + s.platformMargin,
      0,
    );
    const totalFranchiseMargin = franchiseReport.reduce(
      (sum, f) => sum + f.platformMargin,
      0,
    );

    return {
      period: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      },
      summary: {
        totalPlatformMargin:
          Math.round((totalSellerMargin + totalFranchiseMargin) * 100) /
          100,
        totalSellerMargin: Math.round(totalSellerMargin * 100) / 100,
        totalFranchiseMargin:
          Math.round(totalFranchiseMargin * 100) / 100,
      },
      sellers: sellerReport,
      franchises: franchiseReport,
    };
  }

  async getPayoutReport(fromDate: Date, toDate: Date) {
    const dateFilter = {
      paidAt: { gte: fromDate, lte: toDate },
    };

    const [sellerPayouts, franchisePayouts] = await Promise.all([
      this.prisma.sellerSettlement.findMany({
        where: { status: 'PAID', ...dateFilter },
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          sellerId: true,
          sellerName: true,
          totalSettlementAmount: true,
          totalPlatformMargin: true,
          paidAt: true,
          utrReference: true,
          cycle: {
            select: {
              id: true,
              periodStart: true,
              periodEnd: true,
            },
          },
        },
      }),
      this.prisma.franchiseSettlement.findMany({
        where: { status: 'PAID', ...dateFilter },
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          franchiseId: true,
          franchiseName: true,
          netPayableToFranchise: true,
          totalPlatformEarning: true,
          paidAt: true,
          paymentReference: true,
          cycle: {
            select: {
              id: true,
              periodStart: true,
              periodEnd: true,
            },
          },
        },
      }),
    ]);

    const totalSellerPayout = sellerPayouts.reduce(
      (sum, s) => sum + Number(s.totalSettlementAmount || 0),
      0,
    );
    const totalFranchisePayout = franchisePayouts.reduce(
      (sum, f) => sum + Number(f.netPayableToFranchise || 0),
      0,
    );

    return {
      period: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      },
      summary: {
        totalPayouts:
          Math.round((totalSellerPayout + totalFranchisePayout) * 100) /
          100,
        totalSellerPayouts: Math.round(totalSellerPayout * 100) / 100,
        totalFranchisePayouts:
          Math.round(totalFranchisePayout * 100) / 100,
        sellerPayoutCount: sellerPayouts.length,
        franchisePayoutCount: franchisePayouts.length,
      },
      sellerPayouts: sellerPayouts.map((s) => ({
        nodeType: 'SELLER' as const,
        settlementId: s.id,
        nodeId: s.sellerId,
        nodeName: s.sellerName,
        amount: Number(s.totalSettlementAmount),
        platformMargin: Number(s.totalPlatformMargin),
        paidAt: s.paidAt,
        paymentReference: s.utrReference,
        cycleId: s.cycle.id,
        cyclePeriod: `${s.cycle.periodStart.toISOString()} - ${s.cycle.periodEnd.toISOString()}`,
      })),
      franchisePayouts: franchisePayouts.map((f) => ({
        nodeType: 'FRANCHISE' as const,
        settlementId: f.id,
        nodeId: f.franchiseId,
        nodeName: f.franchiseName,
        amount: Number(f.netPayableToFranchise),
        platformMargin: Number(f.totalPlatformEarning),
        paidAt: f.paidAt,
        paymentReference: f.paymentReference,
        cycleId: f.cycle.id,
        cyclePeriod: `${f.cycle.periodStart.toISOString()} - ${f.cycle.periodEnd.toISOString()}`,
      })),
    };
  }

  async getReconciliationReport() {
    const [
      // Seller side
      sellerPlatformRevenue,
      sellerSettlementsDue,
      sellerMarginAgg,
      sellerPendingAgg,
      sellerSettledAgg,
      totalCommissionRecords,
      totalDeliveredSellerItems,
      // Franchise side
      franchiseLedgerAgg,
      franchisePendingAgg,
      franchiseSettledAgg,
      totalLedgerEntries,
    ] = await Promise.all([
      this.prisma.commissionRecord.aggregate({
        _sum: { totalPlatformAmount: true },
      }),
      this.prisma.commissionRecord.aggregate({
        _sum: { totalSettlementAmount: true },
      }),
      this.prisma.commissionRecord.aggregate({
        _sum: { platformMargin: true },
      }),
      this.prisma.commissionRecord.aggregate({
        where: { status: 'PENDING' },
        _sum: { totalSettlementAmount: true },
        _count: { id: true },
      }),
      this.prisma.sellerSettlement.aggregate({
        where: { status: 'PAID' },
        _sum: { totalSettlementAmount: true },
        _count: { id: true },
      }),
      this.prisma.commissionRecord.count(),
      this.prisma.orderItem.count({
        where: {
          subOrder: {
            fulfillmentStatus: 'DELIVERED',
            commissionProcessed: true,
            fulfillmentNodeType: 'SELLER',
          },
        },
      }),
      // Franchise finance ledger totals
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { status: { not: 'REVERSED' } },
        _sum: {
          baseAmount: true,
          platformEarning: true,
          franchiseEarning: true,
        },
        _count: { id: true },
      }),
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PENDING' },
        _sum: { netPayableToFranchise: true },
        _count: { id: true },
      }),
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PAID' },
        _sum: { netPayableToFranchise: true },
        _count: { id: true },
      }),
      this.prisma.franchiseFinanceLedger.count({
        where: { status: { not: 'REVERSED' } },
      }),
    ]);

    const mismatches: string[] = [];

    // Seller reconciliation
    const sellerRevenue = Number(
      sellerPlatformRevenue._sum.totalPlatformAmount || 0,
    );
    const sellerDue = Number(
      sellerSettlementsDue._sum.totalSettlementAmount || 0,
    );
    const sellerMargin = Number(sellerMarginAgg._sum.platformMargin || 0);

    const calculatedSellerMargin =
      Math.round((sellerRevenue - sellerDue) * 100) / 100;
    const reportedSellerMargin = Math.round(sellerMargin * 100) / 100;

    if (Math.abs(calculatedSellerMargin - reportedSellerMargin) > 0.01) {
      mismatches.push(
        `Seller margin mismatch: calculated ${calculatedSellerMargin} vs reported ${reportedSellerMargin}`,
      );
    }

    if (totalDeliveredSellerItems !== totalCommissionRecords) {
      mismatches.push(
        `Delivered seller items (${totalDeliveredSellerItems}) vs commission records (${totalCommissionRecords}) mismatch`,
      );
    }

    // Franchise totals
    const franchiseTotal = Number(
      franchiseLedgerAgg._sum.baseAmount || 0,
    );
    const franchisePlatformEarning = Number(
      franchiseLedgerAgg._sum.platformEarning || 0,
    );
    const franchiseNodeEarning = Number(
      franchiseLedgerAgg._sum.franchiseEarning || 0,
    );

    return {
      seller: {
        totalPlatformRevenue: sellerRevenue,
        totalSellerSettlementsDue: sellerDue,
        totalPlatformMargin: reportedSellerMargin,
        pendingSettlements: {
          count: sellerPendingAgg._count.id,
          amount: Number(
            sellerPendingAgg._sum.totalSettlementAmount || 0,
          ),
        },
        settledPayments: {
          count: sellerSettledAgg._count.id,
          amount: Number(
            sellerSettledAgg._sum.totalSettlementAmount || 0,
          ),
        },
        totalDeliveredItems: totalDeliveredSellerItems,
        totalCommissionRecords,
      },
      franchise: {
        totalBaseAmount: franchiseTotal,
        totalPlatformEarning: franchisePlatformEarning,
        totalFranchiseEarning: franchiseNodeEarning,
        totalLedgerEntries,
        pendingSettlements: {
          count: franchisePendingAgg._count.id,
          amount: Number(
            franchisePendingAgg._sum.netPayableToFranchise || 0,
          ),
        },
        settledPayments: {
          count: franchiseSettledAgg._count.id,
          amount: Number(
            franchiseSettledAgg._sum.netPayableToFranchise || 0,
          ),
        },
      },
      combined: {
        totalPlatformEarnings:
          Math.round(
            (reportedSellerMargin + franchisePlatformEarning) * 100,
          ) / 100,
        totalPayableOutstanding:
          Math.round(
            (Number(sellerPendingAgg._sum.totalSettlementAmount || 0) +
              Number(
                franchisePendingAgg._sum.netPayableToFranchise || 0,
              )) *
              100,
          ) / 100,
        totalPaid:
          Math.round(
            (Number(sellerSettledAgg._sum.totalSettlementAmount || 0) +
              Number(
                franchiseSettledAgg._sum.netPayableToFranchise || 0,
              )) *
              100,
          ) / 100,
      },
      isReconciled: mismatches.length === 0,
      mismatches,
    };
  }
}
