import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchiseFinanceRepository } from '../../domain/repositories/franchise-finance.repository.interface';
import {
  FranchiseLedgerSource,
  FranchiseLedgerStatus,
  FranchiseSettlementStatus,
} from '@prisma/client';

@Injectable()
export class PrismaFranchiseFinanceRepository
  implements FranchiseFinanceRepository
{
  constructor(private readonly prisma: PrismaService) {}

  // ── Ledger CRUD ─────────────────────────────────────────────

  async createLedgerEntry(data: {
    franchiseId: string;
    sourceType: string;
    sourceId: string;
    description?: string;
    baseAmount: number;
    rate: number;
    computedAmount: number;
    platformEarning: number;
    franchiseEarning: number;
  }): Promise<any> {
    return this.prisma.franchiseFinanceLedger.create({
      data: {
        franchiseId: data.franchiseId,
        sourceType: data.sourceType as FranchiseLedgerSource,
        sourceId: data.sourceId,
        description: data.description ?? null,
        baseAmount: data.baseAmount,
        rate: data.rate,
        computedAmount: data.computedAmount,
        platformEarning: data.platformEarning,
        franchiseEarning: data.franchiseEarning,
        status: 'PENDING',
      },
    });
  }

  async findLedgerEntries(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      sourceType?: string;
      status?: string;
      fromDate?: Date;
      toDate?: Date;
    },
  ): Promise<{ entries: any[]; total: number }> {
    const where: any = { franchiseId };

    if (params.sourceType) {
      where.sourceType = params.sourceType as FranchiseLedgerSource;
    }

    if (params.status) {
      where.status = params.status as FranchiseLedgerStatus;
    }

    if (params.fromDate || params.toDate) {
      where.createdAt = {};
      if (params.fromDate) {
        where.createdAt.gte = params.fromDate;
      }
      if (params.toDate) {
        where.createdAt.lte = params.toDate;
      }
    }

    const skip = (params.page - 1) * params.limit;

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.franchiseFinanceLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseFinanceLedger.count({ where }),
    ]);

    return { entries, total };
  }

  async findPendingLedgerEntries(params: {
    fromDate: Date;
    toDate: Date;
    franchiseId?: string;
  }): Promise<any[]> {
    const where: any = {
      status: 'PENDING' as FranchiseLedgerStatus,
      createdAt: {
        gte: params.fromDate,
        lte: params.toDate,
      },
    };

    if (params.franchiseId) {
      where.franchiseId = params.franchiseId;
    }

    return this.prisma.franchiseFinanceLedger.findMany({
      where,
      include: {
        franchise: {
          select: {
            id: true,
            businessName: true,
            franchiseCode: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findLedgerEntryById(id: string): Promise<any | null> {
    return this.prisma.franchiseFinanceLedger.findUnique({
      where: { id },
    });
  }

  async findLedgerEntryBySource(
    sourceType: string,
    sourceId: string,
  ): Promise<any | null> {
    return this.prisma.franchiseFinanceLedger.findFirst({
      where: { sourceType: sourceType as any, sourceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateLedgerEntryStatus(
    id: string,
    status: string,
    settlementBatchId?: string,
  ): Promise<any> {
    const data: any = { status: status as FranchiseLedgerStatus };
    if (settlementBatchId) {
      data.settlementBatchId = settlementBatchId;
    }
    return this.prisma.franchiseFinanceLedger.update({
      where: { id },
      data,
    });
  }

  async bulkUpdateLedgerStatus(
    ids: string[],
    status: string,
    settlementBatchId: string,
  ): Promise<void> {
    await this.prisma.franchiseFinanceLedger.updateMany({
      where: { id: { in: ids } },
      data: {
        status: status as FranchiseLedgerStatus,
        settlementBatchId,
      },
    });
  }

  // ── Settlement CRUD ─────────────────────────────────────────

  async createSettlement(data: {
    cycleId: string;
    franchiseId: string;
    franchiseName: string;
    totalOnlineOrders: number;
    totalOnlineAmount: number;
    totalOnlineCommission: number;
    totalProcurements: number;
    totalProcurementAmount: number;
    totalProcurementFees: number;
    totalPosSales: number;
    totalPosAmount: number;
    totalPosFees: number;
    reversalAmount: number;
    adjustmentAmount: number;
    grossFranchiseEarning: number;
    totalPlatformEarning: number;
    netPayableToFranchise: number;
  }): Promise<any> {
    return this.prisma.franchiseSettlement.create({
      data: {
        cycleId: data.cycleId,
        franchiseId: data.franchiseId,
        franchiseName: data.franchiseName,
        totalOnlineOrders: data.totalOnlineOrders,
        totalOnlineAmount: data.totalOnlineAmount,
        totalOnlineCommission: data.totalOnlineCommission,
        totalProcurements: data.totalProcurements,
        totalProcurementAmount: data.totalProcurementAmount,
        totalProcurementFees: data.totalProcurementFees,
        totalPosSales: data.totalPosSales,
        totalPosAmount: data.totalPosAmount,
        totalPosFees: data.totalPosFees,
        reversalAmount: data.reversalAmount,
        adjustmentAmount: data.adjustmentAmount,
        grossFranchiseEarning: data.grossFranchiseEarning,
        totalPlatformEarning: data.totalPlatformEarning,
        netPayableToFranchise: data.netPayableToFranchise,
        status: 'PENDING',
      },
    });
  }

  async findSettlements(
    franchiseId: string,
    params: { page: number; limit: number; status?: string },
  ): Promise<{ settlements: any[]; total: number }> {
    const where: any = { franchiseId };

    if (params.status) {
      where.status = params.status as FranchiseSettlementStatus;
    }

    const skip = (params.page - 1) * params.limit;

    const [settlements, total] = await this.prisma.$transaction([
      this.prisma.franchiseSettlement.findMany({
        where,
        include: {
          cycle: {
            select: {
              id: true,
              periodStart: true,
              periodEnd: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseSettlement.count({ where }),
    ]);

    return { settlements, total };
  }

  async findSettlementById(id: string): Promise<any | null> {
    return this.prisma.franchiseSettlement.findUnique({
      where: { id },
      include: {
        cycle: {
          select: {
            id: true,
            periodStart: true,
            periodEnd: true,
            status: true,
          },
        },
        franchise: {
          select: {
            id: true,
            franchiseCode: true,
            businessName: true,
            ownerName: true,
          },
        },
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async findSettlementsByFranchiseId(franchiseId: string): Promise<any[]> {
    return this.prisma.franchiseSettlement.findMany({
      where: { franchiseId },
      include: {
        cycle: {
          select: {
            id: true,
            periodStart: true,
            periodEnd: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllSettlementsByCycle(cycleId: string): Promise<any[]> {
    return this.prisma.franchiseSettlement.findMany({
      where: { cycleId },
      include: {
        franchise: {
          select: {
            id: true,
            franchiseCode: true,
            businessName: true,
            ownerName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllSettlementsPaginated(params: {
    page: number;
    limit: number;
    cycleId?: string;
    franchiseId?: string;
    status?: string;
  }): Promise<{ settlements: any[]; total: number }> {
    const where: any = {};

    if (params.cycleId) {
      where.cycleId = params.cycleId;
    }
    if (params.franchiseId) {
      where.franchiseId = params.franchiseId;
    }
    if (params.status) {
      where.status = params.status as FranchiseSettlementStatus;
    }

    const skip = (params.page - 1) * params.limit;

    const [settlements, total] = await this.prisma.$transaction([
      this.prisma.franchiseSettlement.findMany({
        where,
        include: {
          cycle: {
            select: {
              id: true,
              periodStart: true,
              periodEnd: true,
              status: true,
            },
          },
          franchise: {
            select: {
              id: true,
              franchiseCode: true,
              businessName: true,
              ownerName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseSettlement.count({ where }),
    ]);

    return { settlements, total };
  }

  async updateSettlement(
    id: string,
    data: Record<string, unknown>,
  ): Promise<any> {
    return this.prisma.franchiseSettlement.update({
      where: { id },
      data,
    });
  }

  // ── Aggregation for dashboard ───────────────────────────────

  async getEarningsSummary(franchiseId: string): Promise<{
    totalEarnings: number;
    pendingSettlement: number;
    totalPlatformFees: number;
    totalOnlineCommission: number;
    totalProcurementFees: number;
  }> {
    const entries = await this.prisma.franchiseFinanceLedger.findMany({
      where: {
        franchiseId,
        status: { not: 'REVERSED' as FranchiseLedgerStatus },
      },
      select: {
        sourceType: true,
        status: true,
        platformEarning: true,
        franchiseEarning: true,
      },
    });

    let totalEarnings = 0;
    let pendingSettlement = 0;
    let totalPlatformFees = 0;
    let totalOnlineCommission = 0;
    let totalProcurementFees = 0;

    for (const entry of entries) {
      const franchiseEarn = Number(entry.franchiseEarning);
      const platformEarn = Number(entry.platformEarning);

      totalEarnings += franchiseEarn;
      totalPlatformFees += platformEarn;

      if (entry.status === 'PENDING' || entry.status === 'ACCRUED') {
        pendingSettlement += franchiseEarn;
      }

      switch (entry.sourceType) {
        case 'ONLINE_ORDER':
          totalOnlineCommission += platformEarn;
          break;
        case 'PROCUREMENT_FEE':
          totalProcurementFees += platformEarn;
          break;
      }
    }

    return {
      totalEarnings: Math.round(totalEarnings * 100) / 100,
      pendingSettlement: Math.round(pendingSettlement * 100) / 100,
      totalPlatformFees: Math.round(totalPlatformFees * 100) / 100,
      totalOnlineCommission: Math.round(totalOnlineCommission * 100) / 100,
      totalProcurementFees: Math.round(totalProcurementFees * 100) / 100,
    };
  }
}
