import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class SettlementsPublicFacade {
  private readonly logger = new Logger(SettlementsPublicFacade.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a ledger impact from another module (e.g., commission, return reversal).
   */
  async recordLedgerImpact(ledgerEntry: {
    franchiseId?: string;
    sourceType: string;
    sourceId: string;
    baseAmount: number;
    rate: number;
    computedAmount: number;
    platformEarning: number;
    franchiseEarning: number;
    description?: string;
  }): Promise<void> {
    if (ledgerEntry.franchiseId) {
      await this.prisma.franchiseFinanceLedger.create({
        data: {
          franchiseId: ledgerEntry.franchiseId,
          sourceType: ledgerEntry.sourceType as any,
          sourceId: ledgerEntry.sourceId,
          baseAmount: ledgerEntry.baseAmount,
          rate: ledgerEntry.rate,
          computedAmount: ledgerEntry.computedAmount,
          platformEarning: ledgerEntry.platformEarning,
          franchiseEarning: ledgerEntry.franchiseEarning,
          description: ledgerEntry.description ?? null,
        },
      });
    }

    this.logger.log(
      `Ledger impact recorded: ${ledgerEntry.sourceType} for franchise ${ledgerEntry.franchiseId}`,
    );
  }

  /**
   * Preview a settlement for a seller within a date range.
   */
  async previewSettlement(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{
    sellerId: string;
    periodStart: Date;
    periodEnd: Date;
    totalOrders: number;
    totalItems: number;
    totalPlatformAmount: number;
    totalPlatformMargin: number;
    netPayable: number;
  }> {
    const commissions = await this.prisma.commissionRecord.findMany({
      where: {
        sellerId,
        status: 'PENDING',
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    });

    let totalPlatformAmount = 0;
    let totalPlatformMargin = 0;
    const orderIds = new Set<string>();

    for (const c of commissions) {
      totalPlatformAmount += Number(c.platformPrice ?? 0) * (c.quantity ?? 1);
      totalPlatformMargin += Number(c.platformMargin ?? 0);
      if (c.masterOrderId) orderIds.add(c.masterOrderId);
    }

    const netPayable = totalPlatformAmount - totalPlatformMargin;

    return {
      sellerId,
      periodStart,
      periodEnd,
      totalOrders: orderIds.size,
      totalItems: commissions.length,
      totalPlatformAmount,
      totalPlatformMargin,
      netPayable,
    };
  }

  /**
   * Approve a settlement cycle run.
   */
  async approveSettlementRun(runId: string): Promise<void> {
    await this.prisma.settlementCycle.update({
      where: { id: runId },
      data: { status: 'APPROVED' },
    });

    this.logger.log(`Settlement run ${runId} approved`);
  }

  /**
   * Get a payout statement by ID.
   */
  async getPayoutStatement(statementId: string): Promise<{
    id: string;
    sellerId: string;
    cycleId: string;
    totalOrders: number;
    totalItems: number;
    totalPlatformAmount: number;
    totalPlatformMargin: number;
    status: string;
  } | null> {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: statementId },
    });

    if (!settlement) return null;

    return {
      id: settlement.id,
      sellerId: settlement.sellerId,
      cycleId: settlement.cycleId,
      totalOrders: settlement.totalOrders,
      totalItems: settlement.totalItems,
      totalPlatformAmount: Number(settlement.totalPlatformAmount),
      totalPlatformMargin: Number(settlement.totalPlatformMargin),
      status: settlement.status,
    };
  }

  /**
   * Get commission ledger for a seller.
   */
  async getSellerLedger(sellerId: string): Promise<any[]> {
    const records = await this.prisma.commissionRecord.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return records.map((r) => ({
      id: r.id,
      masterOrderId: r.masterOrderId,
      subOrderId: r.subOrderId,
      platformPrice: Number(r.platformPrice ?? 0),
      settlementPrice: Number(r.settlementPrice ?? 0),
      platformMargin: Number(r.platformMargin ?? 0),
      quantity: r.quantity,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Get finance ledger for a franchise partner.
   */
  async getFranchiseLedger(franchiseId: string): Promise<any[]> {
    const records = await this.prisma.franchiseFinanceLedger.findMany({
      where: { franchiseId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return records.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      baseAmount: Number(r.baseAmount),
      computedAmount: Number(r.computedAmount),
      platformEarning: Number(r.platformEarning),
      franchiseEarning: Number(r.franchiseEarning),
      sourceId: r.sourceId,
      description: r.description,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Get affiliate ledger. (Placeholder until affiliate module is built.)
   */
  async getAffiliateLedger(affiliateId: string): Promise<any[]> {
    this.logger.warn(`Affiliate ledger not yet available for ${affiliateId}`);
    return [];
  }
}
