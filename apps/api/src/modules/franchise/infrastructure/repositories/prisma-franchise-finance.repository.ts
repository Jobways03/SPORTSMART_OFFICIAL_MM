import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchiseFinanceRepository } from '../../domain/repositories/franchise-finance.repository.interface';
import {
  FranchiseLedgerSource,
  FranchiseLedgerStatus,
  FranchiseSettlementStatus,
  Prisma,
} from '@prisma/client';

// Phase 181 — event-sourced posts dedup on `type:sourceId`; ADJUSTMENT/PENALTY
// legitimately repeat so they are NOT auto-keyed.
const EVENT_SOURCED = new Set([
  'ONLINE_ORDER', 'POS_SALE', 'POS_SALE_REVERSAL',
  'PROCUREMENT_FEE', 'PROCUREMENT_COST', 'RETURN_REVERSAL',
]);
const D = (n: unknown) => new Prisma.Decimal((n as any) ?? 0);
const toPaise = (d: Prisma.Decimal): bigint =>
  BigInt(d.times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));

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
    // Phase 181 — actor (#5) + explicit idempotency override (#4/#8). `tx` lets a
    // caller compose this into a larger atomic unit (e.g. reversal #6).
    // debit/credit overrides let a compensating entry move the balance WITHOUT a
    // legacy franchise_earning (e.g. a PENDING-void reversal that must be neutral
    // to the legacy aggregator). Provide exactly one positive.
    createdByAdminId?: string | null;
    createdBySystem?: boolean;
    idempotencyKey?: string | null;
    debitInPaise?: bigint;
    creditInPaise?: bigint;
    tx?: any;
  }): Promise<any> {
    // #4/#8 — deterministic dedup key for event-sourced posts.
    const idempotencyKey =
      data.idempotencyKey ??
      (EVENT_SOURCED.has(data.sourceType) ? `${data.sourceType}:${data.sourceId}` : null);

    // Fast path: a re-emitted source event returns the existing row, no insert.
    if (idempotencyKey) {
      const existing = await (data.tx ?? this.prisma).franchiseFinanceLedger.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return existing;
    }

    // #2/#3 — canonical positive debit/credit from the franchise's balance
    // perspective. Procurement fee/cost are franchise liabilities (debit);
    // everything else follows the sign of franchiseEarning. NEVER negative.
    const isProcurement =
      data.sourceType === 'PROCUREMENT_FEE' || data.sourceType === 'PROCUREMENT_COST';
    let creditInPaise = 0n;
    let debitInPaise = 0n;
    if (data.debitInPaise !== undefined || data.creditInPaise !== undefined) {
      // Explicit override (compensating entries) — caller owns the sign rule.
      creditInPaise = data.creditInPaise ?? 0n;
      debitInPaise = data.debitInPaise ?? 0n;
    } else if (isProcurement) {
      debitInPaise = toPaise(D(data.computedAmount).abs());
    } else {
      const fe = D(data.franchiseEarning);
      if (fe.greaterThanOrEqualTo(0)) creditInPaise = toPaise(fe);
      else debitInPaise = toPaise(fe.abs());
    }

    const runCore = async (tx: any): Promise<any> => {
      // #1 — serialize per-franchise so the running balance is consistent and
      // point-in-time-recallable (advisory xact lock, released at commit).
      // Use $executeRaw (not $queryRaw): pg_advisory_xact_lock returns SQL
      // `void`, which $queryRaw cannot deserialize under Prisma 6.19+
      // ("Failed to deserialize column of type 'void'"). $executeRaw returns a
      // row-count and skips column deserialization entirely.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.franchiseId}))`;
      const fr = await tx.franchisePartner.findUnique({
        where: { id: data.franchiseId },
        select: { ledgerBalanceInPaise: true },
      });
      const prev = fr?.ledgerBalanceInPaise ?? 0n;
      const balanceAfterInPaise = prev + creditInPaise - debitInPaise;

      const entry = await tx.franchiseFinanceLedger.create({
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
          debitInPaise,
          creditInPaise,
          balanceAfterInPaise,
          createdByAdminId: data.createdByAdminId ?? null,
          createdBySystem: data.createdBySystem ?? true,
          idempotencyKey,
          status: 'PENDING',
        },
      });
      await tx.franchisePartner.update({
        where: { id: data.franchiseId },
        data: { ledgerBalanceInPaise: balanceAfterInPaise },
      });
      return entry;
    };

    // Composed into a caller's tx → run inline (caller owns atomicity + P2002).
    if (data.tx) return runCore(data.tx);

    try {
      return await this.prisma.$transaction(runCore);
    } catch (err) {
      // Lost the idempotency race — return the row the winner created.
      if (
        idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.franchiseFinanceLedger.findUnique({
          where: { idempotencyKey },
        });
        if (existing) return existing;
      }
      throw err;
    }
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

  // Phase 181 (#14) — a status change appends an immutable history row (actor +
  // reason) instead of being a silent edit; no-op when already at the target
  // status. Amount columns are never touched.
  async updateLedgerEntryStatus(
    id: string,
    status: string,
    settlementBatchId?: string,
    opts?: { actorAdminId?: string | null; reason?: string | null; tx?: any },
  ): Promise<any> {
    const run = async (tx: any): Promise<any> => {
      const current = await tx.franchiseFinanceLedger.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!current) return null;
      if (current.status === (status as FranchiseLedgerStatus)) {
        // Idempotent no-op transition — still allow a settlement-batch link.
        if (settlementBatchId) {
          return tx.franchiseFinanceLedger.update({
            where: { id },
            data: { settlementBatchId },
          });
        }
        return tx.franchiseFinanceLedger.findUnique({ where: { id } });
      }
      const data: any = { status: status as FranchiseLedgerStatus };
      if (settlementBatchId) data.settlementBatchId = settlementBatchId;
      const updated = await tx.franchiseFinanceLedger.update({ where: { id }, data });
      await tx.franchiseLedgerStatusHistory.create({
        data: {
          ledgerEntryId: id,
          fromStatus: current.status,
          toStatus: status,
          actorAdminId: opts?.actorAdminId ?? null,
          reason: opts?.reason ?? null,
        },
      });
      return updated;
    };
    return opts?.tx ? run(opts.tx) : this.prisma.$transaction(run);
  }

  // Phase 181 (#1/#9) — O(1) franchise balance read (no SUM-on-read).
  async getFranchiseBalance(franchiseId: string): Promise<{ balanceInPaise: bigint; currency: string }> {
    const fr = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { ledgerBalanceInPaise: true },
    });
    return { balanceInPaise: fr?.ledgerBalanceInPaise ?? 0n, currency: 'INR' };
  }

  // Phase 181 (#1) — point-in-time balance: the balanceAfter of the last entry
  // posted at/before `asOf`.
  async getFranchiseBalanceAsOf(franchiseId: string, asOf: Date): Promise<bigint> {
    const last = await this.prisma.franchiseFinanceLedger.findFirst({
      where: { franchiseId, createdAt: { lte: asOf } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { balanceAfterInPaise: true },
    });
    return last?.balanceAfterInPaise ?? 0n;
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
        // Phase 251 — frozen dynamic charge breakup (rule-wise) so the detail
        // view can itemize what each active rule deducted at cycle creation.
        chargeLines: { orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] },
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
        // Phase 251 — frozen dynamic charge breakup so the per-franchise
        // settlements list can itemize the deductions + show the net wired.
        chargeLines: { orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] },
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
