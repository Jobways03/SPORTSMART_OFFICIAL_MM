import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../audit/application/facades/audit-public.facade';

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /* ── T3: Create settlement cycle ── */
  async createCycle(periodStart: Date, periodEnd: Date) {
    // Find all PENDING commission records within the date range that
    // aren't already attached to a settlement. The `settlementId: null`
    // guard keeps this idempotent across concurrent / overlapping
    // createCycle calls — a record can only be grouped into one cycle.
    // Without it, two cycles with overlapping date ranges both pick
    // up the same PENDING record and the second updateMany (see below)
    // overwrites the first cycle's settlementId, silently detaching
    // records from the earlier cycle's aggregate totals.
    const pendingRecords = await this.prisma.commissionRecord.findMany({
      where: {
        status: 'PENDING',
        settlementId: null,
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      include: {
        seller: { select: { id: true, sellerShopName: true } },
      },
    });

    if (pendingRecords.length === 0) {
      return {
        cycle: null,
        message: 'No pending commission records found in this date range',
      };
    }

    // Group by seller
    const sellerMap = new Map<
      string,
      {
        sellerName: string;
        records: typeof pendingRecords;
        totalPlatformAmount: number;
        totalSettlementAmount: number;
        totalPlatformMargin: number;
        totalItems: number;
        orderIds: Set<string>;
      }
    >();

    for (const rec of pendingRecords) {
      const existing = sellerMap.get(rec.sellerId);
      if (existing) {
        existing.records.push(rec);
        existing.totalPlatformAmount += Number(rec.totalPlatformAmount);
        existing.totalSettlementAmount += Number(rec.totalSettlementAmount);
        existing.totalPlatformMargin += Number(rec.platformMargin);
        existing.totalItems += rec.quantity;
        existing.orderIds.add(rec.subOrderId);
      } else {
        sellerMap.set(rec.sellerId, {
          sellerName: rec.seller?.sellerShopName || rec.sellerName,
          records: [rec],
          totalPlatformAmount: Number(rec.totalPlatformAmount),
          totalSettlementAmount: Number(rec.totalSettlementAmount),
          totalPlatformMargin: Number(rec.platformMargin),
          totalItems: rec.quantity,
          orderIds: new Set([rec.subOrderId]),
        });
      }
    }

    // Create cycle in a transaction
    const cycle = await this.prisma.$transaction(async (tx) => {
      let cycleTotalAmount = 0;
      let cycleTotalMargin = 0;

      for (const [, data] of sellerMap) {
        cycleTotalAmount += data.totalSettlementAmount;
        cycleTotalMargin += data.totalPlatformMargin;
      }

      const newCycle = await tx.settlementCycle.create({
        data: {
          periodStart,
          periodEnd,
          status: 'DRAFT',
          totalAmount: Math.round(cycleTotalAmount * 100) / 100,
          totalMargin: Math.round(cycleTotalMargin * 100) / 100,
        },
      });

      // Create per-seller settlements
      for (const [sellerId, data] of sellerMap) {
        const sellerSettlement = await tx.sellerSettlement.create({
          data: {
            cycleId: newCycle.id,
            sellerId,
            sellerName: data.sellerName,
            totalOrders: data.orderIds.size,
            totalItems: data.totalItems,
            totalPlatformAmount: Math.round(data.totalPlatformAmount * 100) / 100,
            totalSettlementAmount: Math.round(data.totalSettlementAmount * 100) / 100,
            totalPlatformMargin: Math.round(data.totalPlatformMargin * 100) / 100,
            status: 'PENDING',
          },
        });

        // Link commission records to the settlement. Filter on
        // `settlementId: null` so a concurrent createCycle racing the
        // same record loses the claim — only one cycle wins.
        const recordIds = data.records.map((r) => r.id);
        await tx.commissionRecord.updateMany({
          where: { id: { in: recordIds }, settlementId: null },
          data: { settlementId: sellerSettlement.id },
        });
      }

      return newCycle;
    });

    return { cycle, message: 'Settlement cycle created successfully' };
  }

  /* ── T3: List cycles ── */
  async listCycles(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [cycles, total] = await Promise.all([
      this.prisma.settlementCycle.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { sellerSettlements: true } },
        },
      }),
      this.prisma.settlementCycle.count(),
    ]);

    return {
      cycles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T3: Get cycle detail ── */
  async getCycleDetail(cycleId: string) {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
      include: {
        sellerSettlements: {
          orderBy: { totalSettlementAmount: 'desc' },
          include: {
            _count: { select: { commissionRecords: true } },
          },
        },
      },
    });

    if (!cycle) {
      return null;
    }

    return cycle;
  }

  /* ── T3: Approve cycle ── */
  async approveCycle(cycleId: string) {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
    });

    if (!cycle) {
      return { success: false, message: 'Settlement cycle not found' };
    }

    if (cycle.status !== 'DRAFT' && cycle.status !== 'PREVIEWED') {
      return {
        success: false,
        message: `Cannot approve a cycle with status: ${cycle.status}`,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.settlementCycle.update({
        where: { id: cycleId },
        data: { status: 'APPROVED' },
      });

      await tx.sellerSettlement.updateMany({
        where: { cycleId },
        data: { status: 'APPROVED' },
      });
    });

    return { success: true, message: 'Settlement cycle approved' };
  }

  /* ── T3: Mark a seller settlement as paid ── */
  async markSettlementPaid(
    settlementId: string,
    utrReference: string,
    actorContext?: { adminId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
      include: { cycle: true },
    });

    if (!settlement) {
      return { success: false, message: 'Seller settlement not found' };
    }

    if (settlement.status === 'PAID') {
      return { success: false, message: 'Settlement already marked as paid' };
    }

    if (settlement.cycle.status !== 'APPROVED') {
      return {
        success: false,
        message: 'Settlement cycle must be approved before marking paid',
      };
    }

    await this.prisma.$transaction(async (tx) => {
      // Mark seller settlement as paid
      await tx.sellerSettlement.update({
        where: { id: settlementId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          utrReference,
        },
      });

      // Update all linked commission records to SETTLED
      await tx.commissionRecord.updateMany({
        where: { settlementId },
        data: { status: 'SETTLED' },
      });

      // Check if all seller settlements in the cycle are paid
      const pendingCount = await tx.sellerSettlement.count({
        where: {
          cycleId: settlement.cycleId,
          status: { not: 'PAID' },
        },
      });

      if (pendingCount === 0) {
        await tx.settlementCycle.update({
          where: { id: settlement.cycleId },
          data: { status: 'PAID' },
        });
      }
    });

    // Audit the payout — settlement payouts are real money movements and
    // need to be traceable to a specific admin action with the UTR.
    this.audit
      .writeAuditLog({
        actorId: actorContext?.adminId,
        actorRole: 'ADMIN',
        action: 'MARK_SETTLEMENT_PAID',
        module: 'settlements',
        resource: 'seller_settlement',
        resourceId: settlementId,
        oldValue: { status: settlement.status },
        newValue: { status: 'PAID', utrReference },
        metadata: {
          sellerId: settlement.sellerId,
          cycleId: settlement.cycleId,
          amount: Number(settlement.totalSettlementAmount ?? 0),
        },
        ipAddress: actorContext?.ipAddress,
        userAgent: actorContext?.userAgent,
      })
      .catch((err) => {
        this.logger.error(`Audit write failed: ${(err as Error).message}`);
      });

    return { success: true, message: 'Settlement marked as paid' };
  }

  /* ── T4: Seller earnings summary ── */
  async getSellerEarningsSummary(sellerId: string) {
    // Total earned (all SETTLED records)
    const settledAgg = await this.prisma.commissionRecord.aggregate({
      where: { sellerId, status: 'SETTLED' },
      _sum: { totalSettlementAmount: true },
    });

    // Pending settlement (all PENDING records)
    const pendingAgg = await this.prisma.commissionRecord.aggregate({
      where: { sellerId, status: 'PENDING' },
      _sum: { totalSettlementAmount: true },
    });

    // Last payout
    const lastPayout = await this.prisma.sellerSettlement.findFirst({
      where: { sellerId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      select: {
        totalSettlementAmount: true,
        paidAt: true,
        utrReference: true,
      },
    });

    return {
      totalEarned: Number(settledAgg._sum.totalSettlementAmount || 0),
      pendingSettlement: Number(pendingAgg._sum.totalSettlementAmount || 0),
      lastPayout: lastPayout
        ? {
            amount: Number(lastPayout.totalSettlementAmount),
            paidAt: lastPayout.paidAt,
            utrReference: lastPayout.utrReference,
          }
        : null,
    };
  }

  /* ── T4: Seller commission records (paginated) ── */
  async getSellerCommissionRecords(
    sellerId: string,
    page: number,
    limit: number,
    search?: string,
    status?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { sellerId };

    if (status && ['PENDING', 'ON_HOLD', 'SETTLED', 'REFUNDED'].includes(status)) {
      where.status = status;
    } else {
      // Mirror the admin list behaviour: refunded + held commissions are
      // hidden by default. Sellers can opt in by picking the explicit
      // filter. "Held" records will flip back to PENDING automatically
      // when admin rejects the return (seller earns) or stay frozen
      // while the return is in progress.
      where.status = { notIn: ['REFUNDED', 'ON_HOLD'] };
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { productTitle: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T4: Seller settlement history ── */
  async getSellerSettlementHistory(sellerId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [settlements, total] = await Promise.all([
      this.prisma.sellerSettlement.findMany({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          cycle: {
            select: { periodStart: true, periodEnd: true, status: true },
          },
        },
      }),
      this.prisma.sellerSettlement.count({ where: { sellerId } }),
    ]);

    return {
      settlements,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T5: Admin margin summary ── */
  async getAdminMarginSummary() {
    const [totalPlatformAgg, totalSettlementAgg, totalMarginAgg] =
      await Promise.all([
        this.prisma.commissionRecord.aggregate({
          _sum: { totalPlatformAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { totalSettlementAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { platformMargin: true },
        }),
      ]);

    const pendingSettlements = await this.prisma.commissionRecord.aggregate({
      where: { status: 'PENDING' },
      _sum: { totalSettlementAmount: true },
    });

    const paidSettlements = await this.prisma.sellerSettlement.aggregate({
      where: { status: 'PAID' },
      _sum: { totalSettlementAmount: true },
    });

    return {
      totalPlatformRevenue: Number(totalPlatformAgg._sum.totalPlatformAmount || 0),
      totalSellerPayouts: Number(paidSettlements._sum.totalSettlementAmount || 0),
      totalPlatformMargin: Number(totalMarginAgg._sum.platformMargin || 0),
      pendingSettlementAmount: Number(pendingSettlements._sum.totalSettlementAmount || 0),
      totalSettlementsDue: Number(totalSettlementAgg._sum.totalSettlementAmount || 0),
    };
  }

  /* ── T5: Admin per-seller breakdown ── */
  async getAdminSellerBreakdown(page: number, limit: number) {
    const skip = (page - 1) * limit;

    // Get unique sellers with commission records
    const sellers = await this.prisma.commissionRecord.groupBy({
      by: ['sellerId', 'sellerName'],
      _sum: {
        totalPlatformAmount: true,
        totalSettlementAmount: true,
        platformMargin: true,
      },
      _count: { id: true },
      orderBy: { _sum: { totalPlatformAmount: 'desc' } },
      skip,
      take: limit,
    });

    const total = await this.prisma.commissionRecord.groupBy({
      by: ['sellerId'],
      _count: { id: true },
    });

    return {
      sellers: sellers.map((s) => ({
        sellerId: s.sellerId,
        sellerName: s.sellerName,
        totalRecords: s._count.id,
        totalPlatformAmount: Number(s._sum.totalPlatformAmount || 0),
        totalSettlementAmount: Number(s._sum.totalSettlementAmount || 0),
        totalPlatformMargin: Number(s._sum.platformMargin || 0),
      })),
      pagination: {
        page,
        limit,
        total: total.length,
        totalPages: Math.ceil(total.length / limit),
      },
    };
  }

  /* ── T6: Reconciliation ── */
  async getReconciliation() {
    // Total platform revenue: sum of all commission records totalPlatformAmount
    const platformRevenueAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { totalPlatformAmount: true },
    });

    // Total seller settlements due: sum of all commission records totalSettlementAmount
    const sellerSettlementsAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { totalSettlementAmount: true },
    });

    // Total platform margin
    const marginAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { platformMargin: true },
    });

    // Pending settlements (not yet paid)
    const pendingAgg = await this.prisma.commissionRecord.aggregate({
      where: { status: 'PENDING' },
      _sum: { totalSettlementAmount: true, totalPlatformAmount: true },
      _count: { id: true },
    });

    // Settled (paid)
    const settledAgg = await this.prisma.commissionRecord.aggregate({
      where: { status: 'SETTLED' },
      _sum: { totalSettlementAmount: true },
      _count: { id: true },
    });

    // Total delivered order items (should match with commission records processed)
    const totalDeliveredItems = await this.prisma.orderItem.count({
      where: {
        subOrder: {
          fulfillmentStatus: 'DELIVERED',
          commissionProcessed: true,
        },
      },
    });

    const totalCommissionRecords = await this.prisma.commissionRecord.count();

    // Check for mismatches
    const mismatches: string[] = [];

    if (totalDeliveredItems !== totalCommissionRecords) {
      mismatches.push(
        `Delivered items (${totalDeliveredItems}) vs commission records (${totalCommissionRecords}) mismatch`,
      );
    }

    const totalPlatformRevenue = Number(platformRevenueAgg._sum.totalPlatformAmount || 0);
    const totalSellerSettlements = Number(sellerSettlementsAgg._sum.totalSettlementAmount || 0);
    const totalPlatformMargin = Number(marginAgg._sum.platformMargin || 0);

    // Verify margin = revenue - settlements
    const calculatedMargin = Math.round((totalPlatformRevenue - totalSellerSettlements) * 100) / 100;
    const reportedMargin = Math.round(totalPlatformMargin * 100) / 100;

    if (Math.abs(calculatedMargin - reportedMargin) > 0.01) {
      mismatches.push(
        `Margin mismatch: calculated ${calculatedMargin} vs reported ${reportedMargin}`,
      );
    }

    return {
      totalPlatformRevenue,
      totalSellerSettlements,
      totalPlatformMargin,
      pendingSettlements: {
        count: pendingAgg._count.id,
        amount: Number(pendingAgg._sum.totalSettlementAmount || 0),
        platformAmount: Number(pendingAgg._sum.totalPlatformAmount || 0),
      },
      settledPayments: {
        count: settledAgg._count.id,
        amount: Number(settledAgg._sum.totalSettlementAmount || 0),
      },
      totalDeliveredItems,
      totalCommissionRecords,
      isReconciled: mismatches.length === 0,
      mismatches,
    };
  }
}
