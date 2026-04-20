import { Injectable, Inject } from '@nestjs/common';
import {
  FranchiseFinanceRepository,
  FRANCHISE_FINANCE_REPOSITORY,
} from '../../domain/repositories/franchise-finance.repository.interface';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

@Injectable()
export class FranchiseSettlementService {
  constructor(
    @Inject(FRANCHISE_FINANCE_REPOSITORY)
    private readonly financeRepo: FranchiseFinanceRepository,
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('FranchiseSettlementService');
  }

  // ── Create settlement cycle ─────────────────────────────────

  async createSettlementCycle(periodStart: Date, periodEnd: Date) {
    // Wrap the entire cycle creation in a transaction for atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Find or create SettlementCycle for the period
      let cycle = await tx.settlementCycle.findFirst({
        where: {
          periodStart,
          periodEnd,
        },
      });

      if (!cycle) {
        cycle = await tx.settlementCycle.create({
          data: {
            periodStart,
            periodEnd,
            status: 'DRAFT',
          },
        });
      }

      // 2. Find all PENDING franchise ledger entries within date range
      const pendingEntries = await tx.franchiseFinanceLedger.findMany({
        where: {
          status: 'PENDING',
          createdAt: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
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

      if (pendingEntries.length === 0) {
        return { cycle, settlements: [] as any[], empty: true };
      }

      // 3. Group by franchiseId
      const grouped = new Map<string, any[]>();
      for (const entry of pendingEntries) {
        const fid = entry.franchiseId;
        if (!grouped.has(fid)) {
          grouped.set(fid, []);
        }
        grouped.get(fid)!.push(entry);
      }

      // 4. For each franchise, aggregate and create settlement
      const settlements: any[] = [];

      for (const [franchiseId, entries] of grouped) {
        // Determine franchise name from the first entry's relation or look up
        let franchiseName = 'Unknown';
        const firstEntry = entries[0];
        if (firstEntry.franchise?.businessName) {
          franchiseName = firstEntry.franchise.businessName;
        } else {
          const franchise = await this.franchiseRepo.findById(franchiseId);
          if (franchise) {
            franchiseName = franchise.businessName;
          }
        }

        // Aggregate by sourceType
        let totalOnlineOrders = 0;
        let totalOnlineAmount = 0;
        let totalOnlineCommission = 0;
        let totalProcurements = 0;
        let totalProcurementAmount = 0;
        let totalProcurementFees = 0;
        let totalPosSales = 0;
        let totalPosAmount = 0;
        let totalPosFees = 0;
        let reversalAmount = 0;
        let adjustmentAmount = 0;
        let grossFranchiseEarning = 0;
        let totalPlatformEarning = 0;

        for (const entry of entries) {
          const base = Number(entry.baseAmount);
          const platform = Number(entry.platformEarning);
          const franchiseEarn = Number(entry.franchiseEarning);

          grossFranchiseEarning += franchiseEarn;
          totalPlatformEarning += platform;

          switch (entry.sourceType) {
            case 'ONLINE_ORDER':
              totalOnlineOrders += 1;
              totalOnlineAmount += base;
              totalOnlineCommission += platform;
              break;
            case 'PROCUREMENT_FEE':
              totalProcurements += 1;
              totalProcurementAmount += base;
              totalProcurementFees += platform;
              break;
            case 'POS_SALE':
              // Each POS_SALE entry is one completed sale; base/platform are
              // always positive for this sourceType (void path short-circuits
              // via updateLedgerEntryStatus REVERSED, so won't reach here).
              totalPosSales += 1;
              totalPosAmount += base;
              totalPosFees += platform;
              break;
            case 'POS_SALE_REVERSAL':
              // Paired reversal for a partial/full POS return. Amounts are
              // negative; subtract them from the corresponding POS totals
              // so the settlement reflects NET POS activity for the cycle.
              totalPosAmount += base;       // base is negative → subtracts
              totalPosFees += platform;     // platform is negative → subtracts
              break;
            case 'RETURN_REVERSAL':
              reversalAmount += Math.abs(franchiseEarn);
              break;
            case 'ADJUSTMENT':
              adjustmentAmount += franchiseEarn;
              break;
          }
        }

        const netPayableToFranchise =
          Math.round(
            (grossFranchiseEarning - reversalAmount - adjustmentAmount) * 100,
          ) / 100;

        // Create settlement within transaction
        const settlement = await tx.franchiseSettlement.create({
          data: {
            cycleId: cycle.id,
            franchiseId,
            franchiseName,
            totalOnlineOrders,
            totalOnlineAmount: Math.round(totalOnlineAmount * 100) / 100,
            totalOnlineCommission: Math.round(totalOnlineCommission * 100) / 100,
            totalProcurements,
            totalProcurementAmount: Math.round(totalProcurementAmount * 100) / 100,
            totalProcurementFees: Math.round(totalProcurementFees * 100) / 100,
            totalPosSales,
            totalPosAmount: Math.round(totalPosAmount * 100) / 100,
            totalPosFees: Math.round(totalPosFees * 100) / 100,
            reversalAmount: Math.round(reversalAmount * 100) / 100,
            adjustmentAmount: Math.round(adjustmentAmount * 100) / 100,
            grossFranchiseEarning: Math.round(grossFranchiseEarning * 100) / 100,
            totalPlatformEarning: Math.round(totalPlatformEarning * 100) / 100,
            netPayableToFranchise,
            status: 'PENDING',
          },
        });

        // Link ledger entries to settlement via settlementBatchId + mark ACCRUED
        const entryIds = entries.map((e: any) => e.id);
        await tx.franchiseFinanceLedger.updateMany({
          where: { id: { in: entryIds } },
          data: {
            status: 'ACCRUED',
            settlementBatchId: settlement.id,
          },
        });

        settlements.push(settlement);
      }

      return { cycle, settlements, empty: false };
    });

    if (result.empty) {
      this.logger.log(
        `No pending franchise ledger entries found for period ${periodStart.toISOString()} - ${periodEnd.toISOString()}`,
      );
      return { cycle: result.cycle, settlements: [], message: 'No pending entries found' };
    }

    await this.eventBus.publish({
      eventName: 'franchise.settlement.cycle_created',
      aggregate: 'SettlementCycle',
      aggregateId: result.cycle.id,
      occurredAt: new Date(),
      payload: {
        cycleId: result.cycle.id,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        franchiseSettlementCount: result.settlements.length,
      },
    });

    this.logger.log(
      `Settlement cycle created — cycleId=${result.cycle.id}, ${result.settlements.length} franchise settlements`,
    );

    return { cycle: result.cycle, settlements: result.settlements };
  }

  // ── Approve settlement ──────────────────────────────────────

  async approveSettlement(settlementId: string) {
    const settlement = await this.financeRepo.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundAppException('Franchise settlement not found');
    }
    if (settlement.status !== 'PENDING' && settlement.status !== 'FAILED') {
      throw new BadRequestAppException(
        `Cannot approve a settlement with status ${settlement.status}. Only PENDING or FAILED settlements can be approved.`,
      );
    }

    const updated = await this.financeRepo.updateSettlement(settlementId, {
      status: 'APPROVED',
    });

    await this.eventBus.publish({
      eventName: 'franchise.settlement.approved',
      aggregate: 'FranchiseSettlement',
      aggregateId: settlementId,
      occurredAt: new Date(),
      payload: {
        settlementId,
        franchiseId: settlement.franchiseId,
        netPayableToFranchise: Number(settlement.netPayableToFranchise),
      },
    });

    this.logger.log(
      `Franchise settlement ${settlementId} approved — franchise=${settlement.franchiseId}`,
    );

    return updated;
  }

  // ── Mark settlement as paid ─────────────────────────────────

  async markSettlementPaid(
    settlementId: string,
    paymentReference: string,
  ) {
    const settlement = await this.financeRepo.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundAppException('Franchise settlement not found');
    }
    if (settlement.status !== 'APPROVED') {
      throw new BadRequestAppException(
        `Cannot mark as paid. Settlement status is ${settlement.status}. Only APPROVED settlements can be marked as paid.`,
      );
    }

    const updated = await this.financeRepo.updateSettlement(settlementId, {
      status: 'PAID',
      paidAt: new Date(),
      paymentReference,
    });

    // Mark all linked ledger entries as SETTLED
    if (settlement.ledgerEntries && settlement.ledgerEntries.length > 0) {
      const entryIds = settlement.ledgerEntries.map((e: any) => e.id);
      await this.financeRepo.bulkUpdateLedgerStatus(
        entryIds,
        'SETTLED',
        settlementId,
      );
    }

    await this.eventBus.publish({
      eventName: 'franchise.settlement.paid',
      aggregate: 'FranchiseSettlement',
      aggregateId: settlementId,
      occurredAt: new Date(),
      payload: {
        settlementId,
        franchiseId: settlement.franchiseId,
        paymentReference,
        netPayableToFranchise: Number(settlement.netPayableToFranchise),
      },
    });

    this.logger.log(
      `Franchise settlement ${settlementId} marked as PAID — ref=${paymentReference}`,
    );

    return updated;
  }

  // ── Mark settlement as failed ────────────────────────────────

  async markSettlementFailed(settlementId: string, reason?: string) {
    const settlement = await this.financeRepo.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundAppException('Settlement not found');
    }
    if (settlement.status !== 'APPROVED') {
      throw new BadRequestAppException(
        'Only APPROVED settlements can be marked as failed',
      );
    }

    const updated = await this.financeRepo.updateSettlement(settlementId, {
      status: 'FAILED',
    });

    await this.eventBus
      .publish({
        eventName: 'franchise.settlement.failed',
        aggregate: 'FranchiseSettlement',
        aggregateId: settlementId,
        occurredAt: new Date(),
        payload: {
          settlementId,
          franchiseId: settlement.franchiseId,
          reason: reason ?? 'No reason provided',
          netPayableToFranchise: Number(settlement.netPayableToFranchise),
        },
      })
      .catch(() => {});

    this.logger.log(
      `Franchise settlement ${settlementId} marked as FAILED — reason=${reason ?? 'N/A'}`,
    );

    return updated;
  }

  // ── List settlements (admin) ────────────────────────────────

  async listSettlements(params: {
    page: number;
    limit: number;
    cycleId?: string;
    franchiseId?: string;
    status?: string;
  }) {
    return this.financeRepo.findAllSettlementsPaginated(params);
  }

  // ── Get settlement detail ───────────────────────────────────

  async getSettlementDetail(settlementId: string) {
    const settlement = await this.financeRepo.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundAppException('Franchise settlement not found');
    }
    return settlement;
  }
}
