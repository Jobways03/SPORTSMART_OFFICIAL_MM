import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  AccountsRepository,
  ACCOUNTS_REPOSITORY,
} from '../../domain/repositories/accounts.repository.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { BadRequestAppException } from '../../../../core/exceptions';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import { SettlementService } from '../../../settlements/settlement.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

type BatchActorContext = {
  adminId?: string;
  ipAddress?: string;
  userAgent?: string;
};

type BatchMarkPaidItem = {
  id: string;
  type: 'seller' | 'franchise';
  reference: string;
};

type BatchMarkPaidResult = {
  id: string;
  type: 'seller' | 'franchise';
  success: boolean;
  error?: string;
};

@Injectable()
export class AccountsSettlementService {
  private readonly logger = new Logger(AccountsSettlementService.name);

  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepo: AccountsRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    // Phase 7 (PR 7.5) — paise-sibling dual-write for franchise +
    // seller settlement cycle creates.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
    // Phase 146 — batch seller mark-paid delegates here (audit + TCS/TDS +
    // version-CAS + UTR-unique + paise, all inherited from the single path).
    private readonly settlementService: SettlementService,
    // Phase 146 — franchise batch mark-paid writes its own audit row.
    private readonly audit: AuditPublicFacade,
  ) {}

  async listSettlementCycles(
    page: number,
    limit: number,
    status?: string,
  ) {
    return this.accountsRepo.getSettlementCycles({ page, limit, status });
  }

  async getPayablesSummary(
    page: number,
    limit: number,
    nodeType?: 'SELLER' | 'FRANCHISE' | 'ALL',
    status?: 'PENDING' | 'APPROVED' | 'PAID',
    search?: string,
  ) {
    return this.accountsRepo.getPayablesSummary({
      page,
      limit,
      nodeType,
      status,
      search,
    });
  }

  /**
   * Audit timeline for a single franchise ledger entry. Includes the entry
   * itself plus every RETURN_REVERSAL that points at the same sourceId /
   * franchise, ordered oldest-first. Mirrors the shape of the seller-side
   * commission history so admin UIs can share a single component.
   */
  async getFranchiseLedgerHistory(entryId: string) {
    const entry = await this.prisma.franchiseFinanceLedger.findUnique({
      where: { id: entryId },
      include: {
        franchise: {
          select: { franchiseCode: true, businessName: true, ownerName: true },
        },
        settlementBatch: {
          select: { id: true, paidAt: true, paymentReference: true },
        },
      },
    });
    if (!entry) {
      throw new BadRequestAppException('Franchise ledger entry not found');
    }

    const reversals = await this.prisma.franchiseFinanceLedger.findMany({
      where: {
        franchiseId: entry.franchiseId,
        sourceId: entry.sourceId,
        sourceType: 'RETURN_REVERSAL',
      },
      orderBy: { createdAt: 'asc' },
    });

    type Event =
      | {
          type: 'COMMISSION_ACCRUED';
          at: Date;
          sourceType: string;
          baseAmount: number;
          platformEarning: number;
          franchiseEarning: number;
        }
      | {
          type: 'REVERSAL';
          at: Date;
          entryId: string;
          baseAmount: number;
          franchiseEarning: number;
          description: string | null;
        }
      | {
          type: 'SETTLEMENT_PAID';
          at: Date;
          settlementId: string;
          paymentReference: string | null;
        };

    const timeline: Event[] = [];
    timeline.push({
      type: 'COMMISSION_ACCRUED',
      at: entry.createdAt,
      sourceType: entry.sourceType,
      baseAmount: Number(entry.baseAmount),
      platformEarning: Number(entry.platformEarning),
      franchiseEarning: Number(entry.franchiseEarning),
    });
    for (const r of reversals) {
      timeline.push({
        type: 'REVERSAL',
        at: r.createdAt,
        entryId: r.id,
        baseAmount: Number(r.baseAmount),
        franchiseEarning: Number(r.franchiseEarning),
        description: r.description,
      });
    }
    if (entry.settlementBatch?.paidAt) {
      timeline.push({
        type: 'SETTLEMENT_PAID',
        at: entry.settlementBatch.paidAt,
        settlementId: entry.settlementBatch.id,
        paymentReference: entry.settlementBatch.paymentReference,
      });
    }
    timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

    const netFranchiseEarning =
      Math.round(
        (Number(entry.franchiseEarning) +
          reversals.reduce((sum, r) => sum + Number(r.franchiseEarning), 0)) *
          100,
      ) / 100;

    return {
      entry,
      reversalCount: reversals.length,
      netFranchiseEarning,
      timeline,
    };
  }

  /**
   * Unpaginated franchise ledger fetch for CSV export. Same 50k hard cap as
   * the commission export — operators should narrow their date range if they
   * see `truncated: true`.
   */
  async exportFranchiseLedger(filter: {
    franchiseId?: string;
    sourceType?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    const HARD_CAP = 50_000;
    const where: any = {};
    if (filter.franchiseId) where.franchiseId = filter.franchiseId;
    if (filter.sourceType) where.sourceType = filter.sourceType;
    if (filter.status) where.status = filter.status;
    if (filter.fromDate || filter.toDate) {
      where.createdAt = {};
      if (filter.fromDate) where.createdAt.gte = new Date(filter.fromDate);
      if (filter.toDate) {
        const end = new Date(filter.toDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const total = await this.prisma.franchiseFinanceLedger.count({ where });
    const rows = await this.prisma.franchiseFinanceLedger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: HARD_CAP,
      include: {
        franchise: {
          select: { franchiseCode: true, businessName: true, ownerName: true },
        },
        settlementBatch: {
          select: { id: true, paidAt: true, paymentReference: true },
        },
      },
    });
    return { rows, total, truncated: total > rows.length };
  }

  /**
   * Unpaginated cycle export: all seller + franchise settlements for a
   * specific cycle, flattened into a single denormalised list. Used by
   * operators to reconcile a cycle against a bank statement.
   */
  async exportCycleBreakdown(cycleId: string) {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) {
      throw new BadRequestAppException('Settlement cycle not found');
    }
    const [sellerSettlements, franchiseSettlements] = await Promise.all([
      this.prisma.sellerSettlement.findMany({
        where: { cycleId },
        orderBy: { totalSettlementAmount: 'desc' },
      }),
      this.prisma.franchiseSettlement.findMany({
        where: { cycleId },
        orderBy: { netPayableToFranchise: 'desc' },
        include: {
          franchise: {
            select: { franchiseCode: true, ownerName: true },
          },
        },
      }),
    ]);
    return { cycle, sellerSettlements, franchiseSettlements };
  }

  /**
   * Unpaginated payout register: one row per PAID settlement in the date
   * range, seller + franchise combined. Designed so accounting can reconcile
   * against bank statement line items — keys include the UTR / payment
   * reference.
   */
  async exportPayoutRegister(fromDate: Date, toDate: Date) {
    if (fromDate >= toDate) {
      throw new BadRequestAppException('fromDate must be before toDate');
    }
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);

    const [sellerPayouts, franchisePayouts] = await Promise.all([
      this.prisma.sellerSettlement.findMany({
        where: {
          status: 'PAID',
          paidAt: { gte: fromDate, lte: end },
        },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.franchiseSettlement.findMany({
        where: {
          status: 'PAID',
          paidAt: { gte: fromDate, lte: end },
        },
        orderBy: { paidAt: 'asc' },
        include: {
          franchise: {
            select: { franchiseCode: true, ownerName: true },
          },
        },
      }),
    ]);
    return { sellerPayouts, franchisePayouts };
  }

  /**
   * Dry-run: aggregate what a cycle for the given window WOULD contain,
   * without persisting. Mirrors the grouping math in
   * `createUnifiedSettlementCycle` so operators can eyeball per-seller and
   * per-franchise totals before firing the real create.
   */
  async previewSettlementCycle(periodStart: Date, periodEnd: Date) {
    if (periodStart >= periodEnd) {
      throw new BadRequestAppException(
        'periodStart must be before periodEnd',
      );
    }

    const adjustedEnd = new Date(periodEnd);
    adjustedEnd.setHours(23, 59, 59, 999);

    const [pendingSellerRecords, pendingFranchiseEntries] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where: {
          status: 'PENDING',
          createdAt: { gte: periodStart, lte: adjustedEnd },
        },
        select: {
          id: true,
          sellerId: true,
          sellerName: true,
          subOrderId: true,
          quantity: true,
          totalPlatformAmount: true,
          totalSettlementAmount: true,
          platformMargin: true,
          seller: { select: { sellerShopName: true } },
        },
      }),
      this.prisma.franchiseFinanceLedger.findMany({
        where: {
          status: 'PENDING',
          createdAt: { gte: periodStart, lte: adjustedEnd },
        },
        select: {
          id: true,
          franchiseId: true,
          sourceType: true,
          baseAmount: true,
          platformEarning: true,
          franchiseEarning: true,
          franchise: { select: { businessName: true } },
        },
      }),
    ]);

    const sellers = new Map<
      string,
      {
        sellerId: string;
        sellerName: string;
        orderCount: number;
        itemCount: number;
        totalPlatformAmount: number;
        totalSettlementAmount: number;
        totalPlatformMargin: number;
        orderIds: Set<string>;
      }
    >();
    for (const rec of pendingSellerRecords) {
      const existing = sellers.get(rec.sellerId);
      if (existing) {
        existing.itemCount += rec.quantity;
        existing.totalPlatformAmount += Number(rec.totalPlatformAmount);
        existing.totalSettlementAmount += Number(rec.totalSettlementAmount);
        existing.totalPlatformMargin += Number(rec.platformMargin);
        existing.orderIds.add(rec.subOrderId);
      } else {
        sellers.set(rec.sellerId, {
          sellerId: rec.sellerId,
          sellerName: rec.seller?.sellerShopName || rec.sellerName,
          orderCount: 0,
          itemCount: rec.quantity,
          totalPlatformAmount: Number(rec.totalPlatformAmount),
          totalSettlementAmount: Number(rec.totalSettlementAmount),
          totalPlatformMargin: Number(rec.platformMargin),
          orderIds: new Set([rec.subOrderId]),
        });
      }
    }

    const franchises = new Map<
      string,
      {
        franchiseId: string;
        franchiseName: string;
        entryCount: number;
        grossFranchiseEarning: number;
        totalPlatformEarning: number;
        reversalAmount: number;
        adjustmentAmount: number;
      }
    >();
    for (const entry of pendingFranchiseEntries) {
      const fid = entry.franchiseId;
      const existing =
        franchises.get(fid) ??
        (franchises.set(fid, {
          franchiseId: fid,
          franchiseName: entry.franchise?.businessName || 'Unknown',
          entryCount: 0,
          grossFranchiseEarning: 0,
          totalPlatformEarning: 0,
          reversalAmount: 0,
          adjustmentAmount: 0,
        }),
        franchises.get(fid)!);
      existing.entryCount += 1;
      existing.grossFranchiseEarning += Number(entry.franchiseEarning);
      existing.totalPlatformEarning += Number(entry.platformEarning);
      if (entry.sourceType === 'RETURN_REVERSAL') {
        existing.reversalAmount += Math.abs(Number(entry.franchiseEarning));
      } else if (entry.sourceType === 'ADJUSTMENT') {
        existing.adjustmentAmount += Number(entry.franchiseEarning);
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;

    const sellerPreview = [...sellers.values()].map((s) => ({
      sellerId: s.sellerId,
      sellerName: s.sellerName,
      totalOrders: s.orderIds.size,
      totalItems: s.itemCount,
      totalPlatformAmount: round(s.totalPlatformAmount),
      totalSettlementAmount: round(s.totalSettlementAmount),
      totalPlatformMargin: round(s.totalPlatformMargin),
    }));

    const franchisePreview = [...franchises.values()].map((f) => ({
      franchiseId: f.franchiseId,
      franchiseName: f.franchiseName,
      entryCount: f.entryCount,
      grossFranchiseEarning: round(f.grossFranchiseEarning),
      totalPlatformEarning: round(f.totalPlatformEarning),
      reversalAmount: round(f.reversalAmount),
      adjustmentAmount: round(f.adjustmentAmount),
      netPayableToFranchise: round(
        f.grossFranchiseEarning - f.reversalAmount - f.adjustmentAmount,
      ),
    }));

    const totalSellerPayable = sellerPreview.reduce(
      (sum, s) => sum + s.totalSettlementAmount,
      0,
    );
    const totalFranchisePayable = franchisePreview.reduce(
      (sum, f) => sum + f.netPayableToFranchise,
      0,
    );
    const totalPlatformEarning =
      sellerPreview.reduce((sum, s) => sum + s.totalPlatformMargin, 0) +
      franchisePreview.reduce((sum, f) => sum + f.totalPlatformEarning, 0);

    return {
      periodStart,
      periodEnd: adjustedEnd,
      sellerPreview,
      franchisePreview,
      summary: {
        sellerCount: sellerPreview.length,
        franchiseCount: franchisePreview.length,
        pendingCommissionRecords: pendingSellerRecords.length,
        pendingFranchiseEntries: pendingFranchiseEntries.length,
        totalSellerPayable: round(totalSellerPayable),
        totalFranchisePayable: round(totalFranchisePayable),
        totalPlatformEarning: round(totalPlatformEarning),
      },
    };
  }

  async createUnifiedSettlementCycle(
    periodStart: Date,
    periodEnd: Date,
  ) {
    if (periodStart >= periodEnd) {
      throw new BadRequestAppException(
        'periodStart must be before periodEnd',
      );
    }

    // Set periodEnd to end of day
    const adjustedEnd = new Date(periodEnd);
    adjustedEnd.setHours(23, 59, 59, 999);

    // ── 1. Process seller commissions ────────────────────────

    const pendingSellerRecords = await this.prisma.commissionRecord.findMany({
      where: {
        status: 'PENDING',
        createdAt: { gte: periodStart, lte: adjustedEnd },
      },
      include: {
        seller: { select: { id: true, sellerShopName: true } },
      },
    });

    // ── 2. Process franchise ledger entries ───────────────────

    const pendingFranchiseEntries =
      await this.prisma.franchiseFinanceLedger.findMany({
        where: {
          status: 'PENDING',
          createdAt: { gte: periodStart, lte: adjustedEnd },
        },
        include: {
          franchise: {
            select: { id: true, businessName: true },
          },
        },
      });

    if (
      pendingSellerRecords.length === 0 &&
      pendingFranchiseEntries.length === 0
    ) {
      return {
        cycle: null,
        sellerSettlementCount: 0,
        franchiseSettlementCount: 0,
        message: 'No pending records found in this date range',
      };
    }

    // ── 3. Group seller records by sellerId ──────────────────

    const sellerMap = new Map<
      string,
      {
        sellerName: string;
        records: typeof pendingSellerRecords;
        totalPlatformAmount: number;
        totalSettlementAmount: number;
        totalPlatformMargin: number;
        totalItems: number;
        orderIds: Set<string>;
      }
    >();

    for (const rec of pendingSellerRecords) {
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

    // ── 4. Group franchise entries by franchiseId ─────────────

    const franchiseMap = new Map<
      string,
      {
        franchiseName: string;
        entries: typeof pendingFranchiseEntries;
        totalOnlineOrders: number;
        totalOnlineAmount: number;
        totalOnlineCommission: number;
        totalProcurements: number;
        totalProcurementAmount: number;
        totalProcurementFees: number;
        reversalAmount: number;
        adjustmentAmount: number;
        grossFranchiseEarning: number;
        totalPlatformEarning: number;
      }
    >();

    for (const entry of pendingFranchiseEntries) {
      const fid = entry.franchiseId;
      if (!franchiseMap.has(fid)) {
        franchiseMap.set(fid, {
          franchiseName:
            entry.franchise?.businessName || 'Unknown',
          entries: [],
          totalOnlineOrders: 0,
          totalOnlineAmount: 0,
          totalOnlineCommission: 0,
          totalProcurements: 0,
          totalProcurementAmount: 0,
          totalProcurementFees: 0,
          reversalAmount: 0,
          adjustmentAmount: 0,
          grossFranchiseEarning: 0,
          totalPlatformEarning: 0,
        });
      }

      const data = franchiseMap.get(fid)!;
      data.entries.push(entry);

      const base = Number(entry.baseAmount);
      const platform = Number(entry.platformEarning);
      const franchise = Number(entry.franchiseEarning);

      data.grossFranchiseEarning += franchise;
      data.totalPlatformEarning += platform;

      switch (entry.sourceType) {
        case 'ONLINE_ORDER':
          data.totalOnlineOrders += 1;
          data.totalOnlineAmount += base;
          data.totalOnlineCommission += platform;
          break;
        case 'PROCUREMENT_FEE':
          data.totalProcurements += 1;
          data.totalProcurementAmount += base;
          data.totalProcurementFees += platform;
          break;
        case 'RETURN_REVERSAL':
          data.reversalAmount += Math.abs(franchise);
          break;
        case 'ADJUSTMENT':
          data.adjustmentAmount += franchise;
          break;
      }
    }

    // ── 5. Create everything in a transaction ────────────────

    const result = await this.prisma.$transaction(async (tx) => {
      // Calculate cycle totals
      let cycleTotalAmount = 0;
      let cycleTotalMargin = 0;

      for (const [, data] of sellerMap) {
        cycleTotalAmount += data.totalSettlementAmount;
        cycleTotalMargin += data.totalPlatformMargin;
      }

      for (const [, data] of franchiseMap) {
        const netPayable =
          data.grossFranchiseEarning -
          data.reversalAmount -
          data.adjustmentAmount;
        cycleTotalAmount += netPayable;
        cycleTotalMargin += data.totalPlatformEarning;
      }

      // Create settlement cycle
      const cycle = await tx.settlementCycle.create({
        data: this.moneyDualWrite.applyPaise('settlementCycle', {
          periodStart,
          periodEnd: adjustedEnd,
          status: 'DRAFT',
          // Decimal-string conversion (PR 7.5) — `Math.round(x*100)/100`
          // produces a fractional JS Number that toPaise refuses.
          totalAmount: cycleTotalAmount.toFixed(2),
          totalMargin: cycleTotalMargin.toFixed(2),
        }),
      });

      // Create per-seller settlements
      let sellerSettlementCount = 0;
      for (const [sellerId, data] of sellerMap) {
        const sellerSettlement = await tx.sellerSettlement.create({
          data: this.moneyDualWrite.applyPaise('sellerSettlement', {
            cycleId: cycle.id,
            sellerId,
            sellerName: data.sellerName,
            totalOrders: data.orderIds.size,
            totalItems: data.totalItems,
            totalPlatformAmount: data.totalPlatformAmount.toFixed(2),
            totalSettlementAmount: data.totalSettlementAmount.toFixed(2),
            totalPlatformMargin: data.totalPlatformMargin.toFixed(2),
            status: 'PENDING',
          }),
        });

        const recordIds = data.records.map((r) => r.id);
        await tx.commissionRecord.updateMany({
          where: { id: { in: recordIds } },
          data: { settlementId: sellerSettlement.id },
        });
        sellerSettlementCount++;
      }

      // Create per-franchise settlements
      let franchiseSettlementCount = 0;
      for (const [franchiseId, data] of franchiseMap) {
        const netPayable =
          Math.round(
            (data.grossFranchiseEarning -
              data.reversalAmount -
              data.adjustmentAmount) *
              100,
          ) / 100;

        const franchiseSettlement = await tx.franchiseSettlement.create({
          data: {
            cycleId: cycle.id,
            franchiseId,
            franchiseName: data.franchiseName,
            totalOnlineOrders: data.totalOnlineOrders,
            totalOnlineAmount:
              Math.round(data.totalOnlineAmount * 100) / 100,
            totalOnlineCommission:
              Math.round(data.totalOnlineCommission * 100) / 100,
            totalProcurements: data.totalProcurements,
            totalProcurementAmount:
              Math.round(data.totalProcurementAmount * 100) / 100,
            totalProcurementFees:
              Math.round(data.totalProcurementFees * 100) / 100,
            totalPosSales: 0,
            totalPosAmount: 0,
            totalPosFees: 0,
            reversalAmount:
              Math.round(data.reversalAmount * 100) / 100,
            adjustmentAmount:
              Math.round(data.adjustmentAmount * 100) / 100,
            grossFranchiseEarning:
              Math.round(data.grossFranchiseEarning * 100) / 100,
            totalPlatformEarning:
              Math.round(data.totalPlatformEarning * 100) / 100,
            netPayableToFranchise: netPayable,
            status: 'PENDING',
          },
        });

        // Link ledger entries
        const entryIds = data.entries.map((e) => e.id);
        await tx.franchiseFinanceLedger.updateMany({
          where: { id: { in: entryIds } },
          data: {
            status: 'ACCRUED',
            settlementBatchId: franchiseSettlement.id,
          },
        });
        franchiseSettlementCount++;
      }

      return {
        cycle,
        sellerSettlementCount,
        franchiseSettlementCount,
      };
    });

    this.logger.log(
      `Unified settlement cycle created — cycleId=${result.cycle.id}, sellers=${result.sellerSettlementCount}, franchises=${result.franchiseSettlementCount}`,
    );

    return {
      ...result,
      message: 'Unified settlement cycle created successfully',
    };
  }

  /**
   * Batch-pay a mix of seller and franchise settlements with individual
   * payment references. Per-item errors don't fail the whole batch — the
   * response surfaces per-item success/failure so an operator can retry just
   * the failed rows. Each item's DB update is atomic on its own.
   *
   * After the per-item work, any parent SettlementCycle whose seller slice is
   * fully paid and franchise slice is fully paid is itself marked PAID.
   */
  async batchMarkPaid(
    items: BatchMarkPaidItem[],
    actorContext?: BatchActorContext,
  ): Promise<{
    results: BatchMarkPaidResult[];
    affectedCycles: string[];
  }> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestAppException('items array is required and non-empty');
    }
    if (items.length > 100) {
      throw new BadRequestAppException(
        'Batch size capped at 100 items per call',
      );
    }

    const ctx: BatchActorContext = actorContext ?? {};
    const results: BatchMarkPaidResult[] = [];
    const affectedCycleIds = new Set<string>();
    // Phase 146 — reject a settlementId listed twice in one payload (the second
    // would otherwise fail with "already paid" mid-batch).
    const seen = new Set<string>();

    for (const item of items) {
      try {
        if (!item.id || !item.type || !item.reference) {
          throw new Error('id, type, and reference are required per item');
        }
        if (item.type !== 'seller' && item.type !== 'franchise') {
          throw new Error(`Unsupported type: ${item.type}`);
        }
        const dedupeKey = `${item.type}:${item.id}`;
        if (seen.has(dedupeKey)) {
          throw new Error('Duplicate settlement in batch payload');
        }
        seen.add(dedupeKey);

        if (item.type === 'seller') {
          const cycleId = await this.markSellerPaid(item.id, item.reference, ctx);
          affectedCycleIds.add(cycleId);
        } else {
          const cycleId = await this.markFranchisePaid(
            item.id,
            item.reference,
            ctx,
          );
          affectedCycleIds.add(cycleId);
        }

        results.push({ id: item.id, type: item.type, success: true });
      } catch (err) {
        results.push({
          id: item.id,
          type: item.type,
          success: false,
          error: (err as Error).message,
        });
      }
    }

    // After all per-item work, sweep each touched cycle: if every child
    // settlement (seller + franchise) is PAID, flip the cycle to PAID.
    for (const cycleId of affectedCycleIds) {
      await this.rollupCycleIfFullyPaid(cycleId);
    }

    this.logger.log(
      `Batch mark-paid by admin=${actorContext?.adminId ?? 'unknown'}: ${results.filter((r) => r.success).length}/${results.length} succeeded across ${affectedCycleIds.size} cycle(s)`,
    );

    return {
      results,
      affectedCycles: [...affectedCycleIds],
    };
  }

  private async markSellerPaid(
    settlementId: string,
    utrReference: string,
    actorContext: BatchActorContext,
  ): Promise<string> {
    // Phase 146 — DELEGATE to the single hardened path so this batch item gets
    // the full treatment: status guards, version-CAS, UTR-unique (P2002),
    // commission cascade (PENDING-guarded), TCS/TDS hooks, paise dual-write,
    // paidByAdminId, and a full audit_logs row with actor/IP/UA. No duplication.
    const result = await this.settlementService.markSettlementPaid(
      settlementId,
      utrReference,
      actorContext,
    );
    if (!result.success) {
      throw new Error(result.message);
    }
    const s = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
      select: { cycleId: true },
    });
    return s!.cycleId;
  }

  private async markFranchisePaid(
    settlementId: string,
    paymentReference: string,
    actorContext: BatchActorContext,
  ): Promise<string> {
    const settlement = await this.prisma.franchiseSettlement.findUnique({
      where: { id: settlementId },
    });
    if (!settlement) throw new Error('Franchise settlement not found');
    if (settlement.status === 'PAID')
      throw new Error('Franchise settlement already paid');
    if (settlement.status !== 'APPROVED')
      throw new Error(
        `Only APPROVED settlements can be paid (current: ${settlement.status})`,
      );

    const ref = paymentReference.trim();

    await this.prisma.$transaction(async (tx) => {
      // Phase 146 — version-CAS + paidByAdminId provenance.
      const claim = await tx.franchiseSettlement.updateMany({
        where: { id: settlementId, status: 'APPROVED' },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentReference: ref,
          paidByAdminId: actorContext.adminId ?? null,
        },
      });
      if (claim.count === 0) {
        throw new Error('Franchise settlement changed state concurrently');
      }
      // Status-only flip — no money column on this update, so no paise sibling
      // to mirror (the ledger amounts were frozen at cycle creation).
      await tx.franchiseFinanceLedger.updateMany({
        where: { settlementBatchId: settlementId },
        data: { status: 'SETTLED' },
      });
    });

    this.eventBus
      .publish({
        eventName: 'franchise.settlement.paid',
        aggregate: 'FranchiseSettlement',
        aggregateId: settlementId,
        occurredAt: new Date(),
        payload: {
          settlementId,
          franchiseId: settlement.franchiseId,
          paymentReference: ref,
          netPayableToFranchise: Number(settlement.netPayableToFranchise),
        },
      })
      .catch(() => {});

    // Phase 146 — franchise payouts are real money movements; audit them too
    // (the seller path audits via markSettlementPaid).
    this.audit
      .writeAuditLog({
        actorId: actorContext.adminId,
        actorRole: 'ADMIN',
        action: 'MARK_SETTLEMENT_PAID',
        module: 'accounts',
        resource: 'franchise_settlement',
        resourceId: settlementId,
        oldValue: { status: settlement.status },
        newValue: { status: 'PAID', paymentReference: ref },
        metadata: {
          franchiseId: settlement.franchiseId,
          cycleId: settlement.cycleId,
          netPayableToFranchise: Number(settlement.netPayableToFranchise),
        },
        ipAddress: actorContext.ipAddress,
        userAgent: actorContext.userAgent,
      })
      .catch((err) => {
        this.logger.error(`Franchise payout audit failed: ${(err as Error).message}`);
      });

    return settlement.cycleId;
  }

  private async rollupCycleIfFullyPaid(cycleId: string): Promise<void> {
    const [sellerPending, franchisePending] = await Promise.all([
      this.prisma.sellerSettlement.count({
        where: { cycleId, status: { not: 'PAID' } },
      }),
      this.prisma.franchiseSettlement.count({
        where: { cycleId, status: { not: 'PAID' } },
      }),
    ]);
    if (sellerPending === 0 && franchisePending === 0) {
      await this.prisma.settlementCycle.update({
        where: { id: cycleId },
        data: { status: 'PAID' },
      });
      this.logger.log(`Settlement cycle ${cycleId} fully paid — marked PAID`);
    }
  }

  /**
   * Transition a cycle from DRAFT to PREVIEWED. This is an operator check-
   * point — once previewed, the numbers have been eyeballed and the cycle
   * is ready for formal approval. We don't touch the child settlements;
   * they stay PENDING.
   */
  async markCyclePreviewed(cycleId: string) {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) {
      throw new BadRequestAppException('Settlement cycle not found');
    }
    if (cycle.status !== 'DRAFT') {
      throw new BadRequestAppException(
        `Cycle is ${cycle.status}; only DRAFT cycles can be moved to PREVIEWED`,
      );
    }
    return this.prisma.settlementCycle.update({
      where: { id: cycleId },
      data: { status: 'PREVIEWED' },
    });
  }

  async getSettlementCycleDetail(cycleId: string) {
    const [cycle, sellerSettlements, franchiseSettlements] =
      await Promise.all([
        this.prisma.settlementCycle.findUnique({
          where: { id: cycleId },
        }),
        this.prisma.sellerSettlement.findMany({
          where: { cycleId },
          orderBy: { totalSettlementAmount: 'desc' },
          include: {
            _count: { select: { commissionRecords: true } },
          },
        }),
        this.prisma.franchiseSettlement.findMany({
          where: { cycleId },
          orderBy: { netPayableToFranchise: 'desc' },
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
        }),
      ]);

    if (!cycle) {
      return null;
    }

    // Phase 33 — side-loaded per-settlement statutory-deduction
    // breakdown (TCS Section 52 + TDS Section 194-O + 18% commission
    // GST). Mirrors the existing `discountDeductionsBySeller` pattern
    // so the frontend can render a tax column / expander without
    // restructuring the cycle response shape. Keyed by SellerSettlement
    // id, not sellerId (the same seller can have multiple settlements
    // across cycles; here we are scoped to one cycle so it's the same
    // 1:1, but keying by settlement id is the safe contract).
    //
    // Paise → string serialisation: BigInt over JSON, precision-safe.
    // Net payout formula mirrors
    // SettlementTds194OHookService.computeNetPayoutInPaise:
    //   net = totalSettlement − tcs − tds − totalCommissionGst
    const settlementsAny = sellerSettlements as Array<
      (typeof sellerSettlements)[number] & {
        tcsDeductedInPaise?: bigint | null;
        tcsRateBpsSnapshot?: number | null;
        tcsFilingPeriod?: string | null;
        tdsDeductedInPaise?: bigint | null;
        tdsRateBpsSnapshot?: number | null;
        tdsFilingPeriod?: string | null;
        commissionGstRateBps?: number | null;
        commissionGstSplitType?: string | null;
        cgstOnCommissionInPaise?: bigint | null;
        sgstOnCommissionInPaise?: bigint | null;
        igstOnCommissionInPaise?: bigint | null;
        totalCommissionGstInPaise?: bigint | null;
      }
    >;
    const taxBreakdownBySettlement: Record<
      string,
      {
        tcsDeductedInPaise: string;
        tcsRateBpsSnapshot: number;
        tcsFilingPeriod: string | null;
        tdsDeductedInPaise: string;
        tdsRateBpsSnapshot: number;
        tdsFilingPeriod: string | null;
        commissionGstRateBps: number;
        commissionGstSplitType: string | null;
        cgstOnCommissionInPaise: string;
        sgstOnCommissionInPaise: string;
        igstOnCommissionInPaise: string;
        totalCommissionGstInPaise: string;
        netPayoutInPaise: string;
      }
    > = {};
    for (const s of settlementsAny) {
      const tcs = s.tcsDeductedInPaise ?? 0n;
      const tds = s.tdsDeductedInPaise ?? 0n;
      const commissionGst = s.totalCommissionGstInPaise ?? 0n;
      // Convert the legacy Decimal totalSettlementAmount to paise via
      // Math.round(x*100). Same conversion the seller payout page
      // uses; safe for amounts up to ~₹90T per row.
      const settlementPaise = BigInt(
        Math.round(Number(s.totalSettlementAmount || 0) * 100),
      );
      let netPaise = settlementPaise - tcs - tds - commissionGst;
      if (netPaise < 0n) netPaise = 0n;
      taxBreakdownBySettlement[s.id] = {
        tcsDeductedInPaise: tcs.toString(),
        tcsRateBpsSnapshot: s.tcsRateBpsSnapshot ?? 100,
        tcsFilingPeriod: s.tcsFilingPeriod ?? null,
        tdsDeductedInPaise: tds.toString(),
        tdsRateBpsSnapshot: s.tdsRateBpsSnapshot ?? 100,
        tdsFilingPeriod: s.tdsFilingPeriod ?? null,
        commissionGstRateBps: s.commissionGstRateBps ?? 1800,
        commissionGstSplitType: s.commissionGstSplitType ?? null,
        cgstOnCommissionInPaise: (s.cgstOnCommissionInPaise ?? 0n).toString(),
        sgstOnCommissionInPaise: (s.sgstOnCommissionInPaise ?? 0n).toString(),
        igstOnCommissionInPaise: (s.igstOnCommissionInPaise ?? 0n).toString(),
        totalCommissionGstInPaise: commissionGst.toString(),
        netPayoutInPaise: netPaise.toString(),
      };
    }

    return {
      cycle,
      sellerSettlements,
      franchiseSettlements,
      taxBreakdownBySettlement,
      summary: {
        totalSellerPayable: sellerSettlements.reduce(
          (sum, s) => sum + Number(s.totalSettlementAmount || 0),
          0,
        ),
        totalFranchisePayable: franchiseSettlements.reduce(
          (sum, f) => sum + Number(f.netPayableToFranchise || 0),
          0,
        ),
        totalPlatformEarning:
          sellerSettlements.reduce(
            (sum, s) => sum + Number(s.totalPlatformMargin || 0),
            0,
          ) +
          franchiseSettlements.reduce(
            (sum, f) => sum + Number(f.totalPlatformEarning || 0),
            0,
          ),
      },
    };
  }
}
