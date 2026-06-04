import { Injectable, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  // ── FRANCHISE-funded discount deduction (Phase 247-FB) ──────
  //
  // Mirrors the seller-funded discount deduction on settlement.service.ts
  // (SELLER side). Sums the SIGNED amount_in_paise of the FRANCHISE
  // discount-liability rows for one franchise inside a cycle window:
  //   APPLIED  → positive (franchise absorbs the discount it funded)
  //   REVERSED → negative (a return credits part/all of it back)
  //   SETTLED  → positive (an already-finalised prior absorb; included so a
  //              re-run / read is stable — the gross stays counted).
  // Summing the signed column nets returns out EXACTLY ONCE — never abs().
  // Returns 0n when the window is unknown or the franchise has no rows.
  private async sumFranchiseDiscountDeduction(
    db: Prisma.TransactionClient | PrismaService,
    franchiseId: string,
    periodStart: Date | null | undefined,
    periodEnd: Date | null | undefined,
  ): Promise<bigint> {
    if (!franchiseId || !periodStart || !periodEnd) return 0n;
    const agg = await db.discountLiabilityLedger.aggregate({
      where: {
        liabilityParty: 'FRANCHISE',
        franchiseId,
        status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] },
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      _sum: { amountInPaise: true },
    });
    return agg._sum.amountInPaise ?? 0n;
  }

  // Phase 247-FB — attach the franchise-funded discount deduction to a loaded
  // settlement (read path). The deduction is NOT a persisted column, so it is
  // re-derived from the ledger against the settlement's franchise + the cycle's
  // window. No-ops (string "0") cleanly when the cycle window is unknown.
  private async attachDiscountDeduction(settlement: any): Promise<any> {
    if (!settlement) return settlement;
    const deduction = await this.sumFranchiseDiscountDeduction(
      this.prisma,
      settlement.franchiseId,
      settlement.cycle?.periodStart ?? null,
      settlement.cycle?.periodEnd ?? null,
    );
    return {
      ...settlement,
      discountFundedDeductionInPaise: deduction.toString(),
    };
  }

  // ── Create settlement cycle ─────────────────────────────────

  async createSettlementCycle(periodStart: Date, periodEnd: Date) {
    // Wrap the entire cycle creation in a transaction for atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Phase 159v (audit #13) — reject a period that OVERLAPS an
      // already-settled franchise cycle (other than this exact period, which is
      // an idempotent re-run). The atomic CLAIM below already prevents
      // double-counting, but an overlapping run would still create an empty
      // second franchise settlement and bloat the audit trail.
      const overlappingCycles = await tx.settlementCycle.findMany({
        where: {
          NOT: { AND: [{ periodStart }, { periodEnd }] },
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart },
        },
        select: { id: true },
      });
      if (overlappingCycles.length > 0) {
        const settledInOverlap = await tx.franchiseSettlement.count({
          where: { cycleId: { in: overlappingCycles.map((c) => c.id) } },
        });
        if (settledInOverlap > 0) {
          throw new BadRequestAppException(
            'A franchise settlement cycle overlapping this period already exists. Choose a non-overlapping period or reuse the existing cycle.',
          );
        }
      }

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

      // 2. Atomically CLAIM the PENDING ledger entries in the period.
      //
      // This used to be a find-then-update: findMany(PENDING in range),
      // then later updateMany by id. Under concurrent admins calling
      // this endpoint with overlapping date ranges, both calls read the
      // same PENDING rows, both compute totals from them, and the
      // second updateMany only overwrites the settlementBatchId — the
      // two FranchiseSettlement rows end up with totals that both
      // include the overlapping entries → franchise double-counted.
      //
      // The fix is to flip status from PENDING to ACCRUED atomically
      // up-front. PostgreSQL takes row-level write locks on the UPDATE,
      // so a racing transaction blocks, re-evaluates `status = PENDING`
      // after we commit, and finds zero rows left to claim in the
      // overlap. We tag them with the cycle id as a temporary marker
      // and re-point them to the per-franchise settlement id in step 5.
      const claimed = await tx.franchiseFinanceLedger.updateMany({
        where: {
          status: 'PENDING',
          createdAt: { gte: periodStart, lte: periodEnd },
          settlementBatchId: null,
        },
        data: {
          status: 'ACCRUED',
          settlementBatchId: cycle.id,
        },
      });

      if (claimed.count === 0) {
        return { cycle, settlements: [] as any[], empty: true };
      }

      // Re-fetch only the rows WE claimed in this transaction — a
      // concurrent cycle cannot have tagged its rows with our cycle.id.
      const pendingEntries = await tx.franchiseFinanceLedger.findMany({
        where: { settlementBatchId: cycle.id },
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
        // Phase 159v (audit #9) — Decimal accumulators (was float + Math.round)
        // so 100s of small-paisa rows don't drift.
        const D = (n: unknown) => new Prisma.Decimal((n as any) ?? 0);
        let totalOnlineOrders = 0;
        let totalProcurements = 0;
        let totalPosSales = 0;
        let totalOnlineAmount = D(0);
        let totalOnlineCommission = D(0);
        let totalProcurementAmount = D(0);
        let totalProcurementFees = D(0);
        let totalPosAmount = D(0);
        let totalPosFees = D(0);
        let reversalAmount = D(0);
        let adjustmentAmount = D(0);
        let grossFranchiseEarning = D(0);
        let totalPlatformEarning = D(0);

        for (const entry of entries) {
          const base = D(entry.baseAmount);
          const platform = D(entry.platformEarning);
          const franchiseEarn = D(entry.franchiseEarning);

          totalPlatformEarning = totalPlatformEarning.plus(platform);

          switch (entry.sourceType) {
            case 'ONLINE_ORDER':
              totalOnlineOrders += 1;
              totalOnlineAmount = totalOnlineAmount.plus(base);
              totalOnlineCommission = totalOnlineCommission.plus(platform);
              // Phase 159v (audit #5) — gross accumulates SALES earnings only.
              grossFranchiseEarning = grossFranchiseEarning.plus(franchiseEarn);
              break;
            case 'PROCUREMENT_FEE':
              totalProcurements += 1;
              totalProcurementAmount = totalProcurementAmount.plus(base);
              totalProcurementFees = totalProcurementFees.plus(platform);
              // franchiseEarning is 0 for a platform fee — not a franchise earning.
              break;
            case 'POS_SALE':
              totalPosSales += 1;
              totalPosAmount = totalPosAmount.plus(base);
              totalPosFees = totalPosFees.plus(platform);
              grossFranchiseEarning = grossFranchiseEarning.plus(franchiseEarn);
              break;
            case 'POS_SALE_REVERSAL':
              // Paired POS return — negative amounts net the POS totals + gross.
              totalPosAmount = totalPosAmount.plus(base);
              totalPosFees = totalPosFees.plus(platform);
              grossFranchiseEarning = grossFranchiseEarning.plus(franchiseEarn);
              break;
            case 'RETURN_REVERSAL':
              // Phase 159v (audit #5) — the online-return clawback lives ONLY in
              // reversalAmount (a positive magnitude); it is NOT also folded
              // into gross, so netPayable subtracts it exactly once.
              reversalAmount = reversalAmount.plus(franchiseEarn.abs());
              break;
            case 'ADJUSTMENT':
              // Phase 159v (audit #4) — signed: +bonus / −penalty. Lives ONLY
              // in adjustmentAmount and is ADDED to net with its own sign.
              adjustmentAmount = adjustmentAmount.plus(franchiseEarn);
              break;
          }
        }

        // Phase 247-FB — FRANCHISE-funded discount cost. The franchise bears
        // the discount it funded, so it is a DEDUCTION from the payout (the
        // mirror of the seller-funded discount on the seller settlement). We
        // sum the SIGNED amount_in_paise of the FRANCHISE discount-liability
        // rows for THIS franchise inside the cycle window: APPLIED is positive,
        // a return's REVERSED row is negative, so the sum nets the credit-back
        // exactly once (no abs() — the Phase 247 #17 discipline). Surfaced as a
        // distinct line (discountFundedDeductionInPaise) so it is visible, not
        // silently folded into another sourceType bucket.
        const discountFundedDeductionInPaise =
          await this.sumFranchiseDiscountDeduction(
            tx,
            franchiseId,
            periodStart,
            periodEnd,
          );
        // paise (BigInt) → rupees (Decimal) at the money boundary, then subtract
        // from the net. A POSITIVE deduction reduces the payout; a net-negative
        // (over-credited returns) would add back — the signed sum handles both.
        const discountDeductionRupees = new Prisma.Decimal(
          discountFundedDeductionInPaise.toString(),
        ).div(100);

        // Phase 159v (audit #4/#5) — gross holds sales earnings only; a return
        // clawback subtracts once; an adjustment adds with its sign.
        // Phase 247-FB — the franchise-funded discount cost subtracts too.
        const netPayableToFranchise = grossFranchiseEarning
          .minus(reversalAmount)
          .plus(adjustmentAmount)
          .minus(discountDeductionRupees)
          .toDecimalPlaces(2);

        // Create settlement within transaction
        const settlement = await tx.franchiseSettlement.create({
          data: {
            cycleId: cycle.id,
            franchiseId,
            franchiseName,
            totalOnlineOrders,
            totalOnlineAmount: totalOnlineAmount.toDecimalPlaces(2),
            totalOnlineCommission: totalOnlineCommission.toDecimalPlaces(2),
            totalProcurements,
            totalProcurementAmount: totalProcurementAmount.toDecimalPlaces(2),
            totalProcurementFees: totalProcurementFees.toDecimalPlaces(2),
            totalPosSales,
            totalPosAmount: totalPosAmount.toDecimalPlaces(2),
            totalPosFees: totalPosFees.toDecimalPlaces(2),
            reversalAmount: reversalAmount.toDecimalPlaces(2),
            adjustmentAmount: adjustmentAmount.toDecimalPlaces(2),
            grossFranchiseEarning: grossFranchiseEarning.toDecimalPlaces(2),
            totalPlatformEarning: totalPlatformEarning.toDecimalPlaces(2),
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

        // Phase 247-FB — surface the franchise-funded discount cost as a
        // response-only field (BigInt → string, the codebase serialises paise
        // as strings). It is NOT a persisted column (already netted into
        // netPayableToFranchise above); attaching it here lets the UI show a
        // distinct "Discount funded" deduction line on the per-franchise row.
        settlements.push({
          ...settlement,
          discountFundedDeductionInPaise:
            discountFundedDeductionInPaise.toString(),
        });
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

    // Phase 159v (audit — "FAILED→APPROVED leaks the old UTR forward") — when a
    // FAILED settlement is re-approved, clear any stale payment reference and
    // paidAt from the failed attempt so they can't be mistaken for the new
    // payout or carried into the next pay. A PENDING→APPROVED has none anyway.
    //
    // Phase 247-FB — finalise the FRANCHISE-funded discount ledger in the SAME
    // transaction that approves the settlement (mirrors the seller approveCycle
    // flip on settlement.service.ts, but per-franchise since the franchise flow
    // approves one settlement at a time). The DiscountLiabilityLedger FRANCHISE
    // rows are written APPLIED at order allocation and otherwise never advance;
    // here we flip the consumed rows APPLIED→SETTLED and stamp settlementCycleId
    // so each row is linked to the cycle that netted it. Atomic with the status
    // flip so "approved" and "discount settled" can never diverge.
    //
    // Scope = this settlement's franchise + the cycle window on createdAt +
    // liabilityParty=FRANCHISE + status=APPLIED. REVERSED / already-SETTLED rows
    // are untouched (REVERSED carries the negative return credit-back and must
    // stay distinct from the gross). Guarded for a null window / missing
    // franchise so it no-ops cleanly.
    const ledgerFranchiseId: string | undefined = settlement.franchiseId;
    const windowStart: Date | null = settlement.cycle?.periodStart ?? null;
    const windowEnd: Date | null = settlement.cycle?.periodEnd ?? null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.franchiseSettlement.update({
        where: { id: settlementId },
        data: {
          status: 'APPROVED',
          paymentReference: null,
          paidAt: null,
        },
      });
      if (ledgerFranchiseId && windowStart && windowEnd) {
        await tx.discountLiabilityLedger.updateMany({
          where: {
            liabilityParty: 'FRANCHISE',
            franchiseId: ledgerFranchiseId,
            status: 'APPLIED',
            createdAt: { gte: windowStart, lte: windowEnd },
          },
          data: {
            status: 'SETTLED',
            settlementCycleId: settlement.cycle?.id ?? null,
          },
        });
      }
      return u;
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

    // Phase 159v (audit #3 + #16) — flip the settlement to PAID and SETTLE its
    // ledger rows in ONE transaction. Two prior bugs:
    //  (#3) two separate writes — a crash between them left the settlement PAID
    //       while its ledger stayed ACCRUED, so "paid" and "settled" diverged.
    //  (#16) the status pre-check above is TOCTOU: two concurrent pay requests
    //       both read APPROVED, both proceed → double money-out + duplicate
    //       `settlement.paid` event. The conditional updateMany below is a
    //       compare-and-swap — only the first caller flips APPROVED→PAID
    //       (count===1); the loser sees count===0 and aborts cleanly. This is
    //       the authoritative guard, enforced at the DB, not just configured.
    const entryIds: string[] = (settlement.ledgerEntries ?? []).map((e: any) => e.id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.franchiseSettlement.updateMany({
        where: { id: settlementId, status: 'APPROVED' },
        data: { status: 'PAID', paidAt: new Date(), paymentReference },
      });
      if (flip.count !== 1) {
        throw new BadRequestAppException(
          'Settlement is no longer APPROVED (it may have just been paid by a concurrent request). No payment was recorded.',
        );
      }
      if (entryIds.length > 0) {
        await tx.franchiseFinanceLedger.updateMany({
          where: { id: { in: entryIds } },
          data: { status: 'SETTLED', settlementBatchId: settlementId },
        });
      }
      const u = await tx.franchiseSettlement.findUnique({
        where: { id: settlementId },
      });
      return u!;
    });

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
    const { settlements, total } =
      await this.financeRepo.findAllSettlementsPaginated(params);
    // Phase 247-FB — attach the per-franchise franchise-funded discount
    // deduction so the list/KPI surfaces the deduction line. Each row already
    // carries its cycle window (the repo eager-loads cycle.periodStart/End), so
    // the deductions resolve in parallel without an N+1 cycle re-fetch.
    const withDeductions = await Promise.all(
      settlements.map((s: any) => this.attachDiscountDeduction(s)),
    );
    return { settlements: withDeductions, total };
  }

  // ── Export settlements (CSV / Tally) ────────────────────────
  // Phase 159v (audit #11) — a finance-facing CSV of the franchise settlement
  // register at the audited surface. (The accounts module also exposes a
  // cross-partner cycle breakdown + the per-entry ledger export; this one is
  // scoped to the franchise settlement summary rows with the same filters as
  // the list endpoint.) Capped + truncation-flagged like the accounts exports.
  async exportSettlements(filters: {
    cycleId?: string;
    franchiseId?: string;
    status?: string;
  }) {
    const CAP = 5000;
    const { settlements, total } =
      await this.financeRepo.findAllSettlementsPaginated({
        page: 1,
        limit: CAP,
        ...filters,
      });
    return { rows: settlements, total, truncated: total > CAP };
  }

  // ── Get settlement detail ───────────────────────────────────

  async getSettlementDetail(settlementId: string) {
    const settlement = await this.financeRepo.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundAppException('Franchise settlement not found');
    }
    // Phase 247-FB — re-derive the franchise-funded discount deduction for the
    // detail view (not a persisted column). findSettlementById eager-loads the
    // cycle (periodStart/periodEnd), so the window is available here.
    return this.attachDiscountDeduction(settlement);
  }
}
