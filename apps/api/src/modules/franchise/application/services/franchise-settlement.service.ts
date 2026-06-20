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
// Phase 250 (Franchise tax) — reuse the seller commission-GST calculator.
import { computeCommissionGst } from '../../../tax/domain/commission-gst-calculator';
import { SettlementTds194OHookService } from '../../../tax/application/services/settlement-tds-194o-hook.service';
import { SettlementTcsHookService } from '../../../tax/application/services/settlement-tcs-hook.service';
// Phase 251 — reuse the seller dynamic-charge calculator (pure, no DI). The
// franchise applies the SAME admin-configured rules, computed against its own
// bases (all channels): Price of Goods Sold = online + POS sales, Commission =
// total platform earning.
// Phase 251 — single source of truth for the settlement net payable.
import { settlementNetFromRow } from '../../../settlements/domain/settlement-net';

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
    // Phase 250 (Franchise tax) — §194-O TDS hook (TaxModule export). Stamps the
    // per-settlement TDS at approval; flips the ledger WITHHELD at pay.
    private readonly tdsHook: SettlementTds194OHookService,
    // Phase 250 (Franchise tax) — §52 TCS hook. Stamps per-settlement TCS at
    // approval; flips the ledger COLLECTED at pay.
    private readonly tcsHook: SettlementTcsHookService,
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

      // 2. READ the candidate PENDING ledger entries for the period. Each
      // franchise's rows are CLAIMED (PENDING → ACCRUED) further down, once
      // its settlement row exists, stamped with the real settlement id.
      //
      // We must NOT stamp settlement_batch_id up-front: that column has a FK
      // to franchise_settlements(id), and the per-franchise settlements don't
      // exist yet. The previous code tagged the *cycle* id as a temporary
      // marker, which violated the FK (P2003 → "A referenced record does not
      // exist") the instant any entry matched — so a franchise cycle with real
      // entries could never be created; only empty cycles ever committed.
      //
      // Concurrency: the per-franchise claim below flips status under a
      // `status = PENDING` guard, so a racing cycle that grabbed an overlapping
      // row updates fewer rows and the count mismatch rolls this tx back — no
      // double-count, even though we read (rather than claim) up-front here.
      //
      // The admin picks calendar dates, so an entry created at ANY time on the
      // periodEnd day must be in range. `new Date(periodEnd)` resolves to that
      // day's 00:00, so an inclusive `lte: periodEnd` silently dropped every
      // entry after midnight (e.g. a commission locked at 07:57 on the end
      // day) — the cause of "Create cycle does nothing and shows no error".
      // Use an exclusive upper bound of the next day to cover the whole day.
      const claimEndExclusive = new Date(periodEnd);
      claimEndExclusive.setUTCDate(claimEndExclusive.getUTCDate() + 1);
      const pendingEntries = await tx.franchiseFinanceLedger.findMany({
        where: {
          status: 'PENDING',
          createdAt: { gte: periodStart, lt: claimEndExclusive },
          settlementBatchId: null,
        },
        include: {
          franchise: {
            select: {
              id: true,
              businessName: true,
              franchiseCode: true,
              // Phase 250 (Franchise tax) — place-of-supply state for commission-GST.
              gstStateCode: true,
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

      // Phase 250 (Franchise tax) — resolve the marketplace GST state once for
      // the commission-GST place-of-supply split (IGST §12(2)(a)). Empty when
      // no PlatformGstProfile is seeded → calculator falls back to inter-state IGST.
      const platformProfile = await tx.platformGstProfile.findFirst({
        where: { isDefault: true, isActive: true },
        select: { gstStateCode: true },
      });
      const marketplaceStateCode = platformProfile?.gstStateCode ?? '';

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

        // Phase 250 (Franchise tax) — 18% GST on the platform's ONLINE
        // commission service to the franchise (SAC 9985, §9 CGST). Place of
        // supply = franchise state (IGST §12(2)(a)): intra → CGST+SGST, inter →
        // IGST. Snapshotted (frozen) so a later state-code change can't rewrite
        // history. POS/procurement fees are excluded (online-only base). The GST
        // is subtracted from the wired payout at mark-paid, not from this net.
        const franchiseStateCode: string =
          (firstEntry.franchise?.gstStateCode as string | undefined) ?? '';
        const commissionGst = computeCommissionGst({
          commissionAmountInPaise: BigInt(
            totalOnlineCommission.mul(100).toFixed(0),
          ),
          marketplaceStateCode,
          sellerStateCode: franchiseStateCode,
        });

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
            // Phase 250 (Franchise tax) — commission-GST snapshot (online base),
            // frozen with the state codes used for the split. Subtracted from
            // the wired payout at mark-paid (Phase 4), not from this net.
            commissionGstRateBps: commissionGst.rateBps,
            commissionGstSplitType: commissionGst.splitType,
            cgstOnCommissionInPaise: commissionGst.cgstInPaise,
            sgstOnCommissionInPaise: commissionGst.sgstInPaise,
            igstOnCommissionInPaise: commissionGst.igstInPaise,
            totalCommissionGstInPaise: commissionGst.totalGstInPaise,
            commissionGstMarketplaceStateCode: marketplaceStateCode || null,
            commissionGstFranchiseStateCode: franchiseStateCode || null,
            status: 'PENDING',
          },
        });

        // Atomically CLAIM this franchise's entries now that the settlement
        // row exists: flip PENDING → ACCRUED and stamp the real settlement id
        // (a valid franchise_settlements FK — the cycle id used here before
        // violated that FK). The `status: 'PENDING'` guard + row locks mean a
        // racing cycle that grabbed any of these rows between our read and here
        // updates fewer rows; the count mismatch aborts the whole tx so the
        // settlement totals (computed from the read) can't include rows we
        // didn't actually claim.
        const entryIds = entries.map((e: any) => e.id);
        const claimed = await tx.franchiseFinanceLedger.updateMany({
          where: { id: { in: entryIds }, status: 'PENDING', settlementBatchId: null },
          data: {
            status: 'ACCRUED',
            settlementBatchId: settlement.id,
          },
        });
        if (claimed.count !== entryIds.length) {
          throw new BadRequestAppException(
            'Another settlement run claimed overlapping ledger entries; please retry.',
          );
        }

        // Phase 252 — generic dynamic charge-rule engine retired. The franchise
        // payout is netted by the statutory taxes only (commission-GST stamped
        // above at creation; §52 TCS / §194-O TDS at approval, config-driven).

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

  // ── Preview settlement cycle (dry-run) ──────────────────────
  //
  // Mirrors createSettlementCycle's candidate read + per-franchise net so the
  // numbers an admin sees are exactly what a subsequent create would write —
  // the seller flow's previewCycle has the same contract. Read-only: no cycle,
  // no claim, no settlement rows, no transaction.
  async previewSettlementCycle(periodStart: Date, periodEnd: Date) {
    // Same end-of-day window as create (entries on the periodEnd day are in).
    const claimEndExclusive = new Date(periodEnd);
    claimEndExclusive.setUTCDate(claimEndExclusive.getUTCDate() + 1);

    // A create is blocked when an overlapping cycle already has franchise
    // settlements (createSettlementCycle throws on that). Surface it as a
    // warning so the admin knows the create won't go through.
    const overlapCycles = await this.prisma.settlementCycle.findMany({
      where: {
        NOT: { AND: [{ periodStart }, { periodEnd }] },
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
      },
      select: { id: true, periodStart: true, periodEnd: true, status: true },
    });
    let overlap: {
      id: string;
      status: string;
      periodStart: Date;
      periodEnd: Date;
    } | null = null;
    if (overlapCycles.length > 0) {
      const settledInOverlap = await this.prisma.franchiseSettlement.count({
        where: { cycleId: { in: overlapCycles.map((c) => c.id) } },
      });
      if (settledInOverlap > 0) {
        const c = overlapCycles[0]!;
        overlap = {
          id: c.id,
          status: c.status,
          periodStart: c.periodStart,
          periodEnd: c.periodEnd,
        };
      }
    }

    const pendingEntries = await this.prisma.franchiseFinanceLedger.findMany({
      where: {
        status: 'PENDING',
        createdAt: { gte: periodStart, lt: claimEndExclusive },
        settlementBatchId: null,
      },
      include: {
        franchise: { select: { id: true, businessName: true, franchiseCode: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by franchise and compute the SAME net createSettlementCycle writes:
    //   net = grossSalesEarning − returnReversals + adjustments − discountFunded
    // (commission-GST / TCS / TDS are applied later at approve/pay, not here).
    // Keep this switch in sync with the create loop's per-entry aggregation.
    const grouped = new Map<string, typeof pendingEntries>();
    for (const e of pendingEntries) {
      const arr = grouped.get(e.franchiseId) ?? [];
      arr.push(e);
      grouped.set(e.franchiseId, arr);
    }

    const D = (n: unknown) => new Prisma.Decimal((n as any) ?? 0);
    let cycleNet = D(0);
    const franchiseBreakdown = await Promise.all(
      Array.from(grouped.entries()).map(async ([franchiseId, entries]) => {
        let gross = D(0);
        let reversal = D(0);
        let adjustment = D(0);
        for (const entry of entries) {
          const fe = D(entry.franchiseEarning);
          switch (entry.sourceType) {
            case 'ONLINE_ORDER':
            case 'POS_SALE':
            case 'POS_SALE_REVERSAL':
              gross = gross.plus(fe);
              break;
            case 'RETURN_REVERSAL':
              reversal = reversal.plus(fe.abs());
              break;
            case 'ADJUSTMENT':
              adjustment = adjustment.plus(fe);
              break;
            // PROCUREMENT_FEE / PROCUREMENT_COST carry 0 franchise earning.
          }
        }
        const discountPaise = await this.sumFranchiseDiscountDeduction(
          this.prisma,
          franchiseId,
          periodStart,
          periodEnd,
        );
        const discountRupees = new Prisma.Decimal(discountPaise.toString()).div(100);
        const net = gross
          .minus(reversal)
          .plus(adjustment)
          .minus(discountRupees)
          .toDecimalPlaces(2);
        cycleNet = cycleNet.plus(net);
        const first = entries[0]!;
        return {
          franchiseId,
          franchiseName: first.franchise?.businessName ?? 'Unknown',
          franchiseCode: first.franchise?.franchiseCode ?? null,
          entryCount: entries.length,
          grossFranchiseEarning: gross.toFixed(2),
          discountFundedDeductionInPaise: discountPaise.toString(),
          netPayableToFranchise: net.toFixed(2),
        };
      }),
    );

    return {
      isDryRun: true as const,
      periodStart,
      periodEnd,
      franchiseCount: grouped.size,
      entryCount: pendingEntries.length,
      totalNetPayable: cycleNet.toFixed(2),
      franchiseBreakdown,
      overlap,
      // "as of" — a point-in-time snapshot; the commission cron may add rows
      // before the operator confirms (create re-aggregates at commit time).
      asOf: new Date().toISOString(),
    };
  }

  // ── Approve settlement ──────────────────────────────────────

  async approveSettlement(
    settlementId: string,
    args?: { approvedByAdminId?: string },
  ) {
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
          // Approval provenance — who signed off and when.
          approvedByAdminId: args?.approvedByAdminId ?? null,
          approvedAt: new Date(),
          // A re-approval of a FAILED row clears the stale payout metadata so it
          // can't be mistaken for / carried into the next pay.
          paymentReference: null,
          paymentMethod: null,
          paymentProofUrl: null,
          paidByAdminId: null,
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

    // Phase 250 (Franchise tax) — compute + stamp §194-O TDS for this settlement
    // now it's APPROVED (mirrors the seller approveCycle hooks). Post-commit,
    // best-effort: a failure leaves the row APPROVED without a tdsLedgerId for
    // finance to re-run — it must NOT roll back the approval.
    try {
      await this.tcsHook.applyToFranchiseSettlementOnApprove({ settlementId });
    } catch (err) {
      this.logger.error(
        `§52 TCS apply failed for franchise settlement ${settlementId}: ${(err as Error).message}`,
      );
    }
    try {
      await this.tdsHook.applyToFranchiseSettlementOnApprove({ settlementId });
    } catch (err) {
      this.logger.error(
        `194-O TDS apply failed for franchise settlement ${settlementId}: ${(err as Error).message}`,
      );
    }

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
  // Captures UTR (unique — duplicate money-out guard) + method + proof +
  // paidByAdminId, and accepts an APPROVED or a retried FAILED settlement.

  async markSettlementPaid(
    settlementId: string,
    args: {
      paymentReference: string;
      paymentMethod?: string;
      paymentProofUrl?: string;
      paidByAdminId?: string;
    },
  ) {
    const { paymentReference, paymentMethod, paymentProofUrl, paidByAdminId } =
      args;
    const settlement = await this.financeRepo.findSettlementById(settlementId);
    if (!settlement) {
      throw new NotFoundAppException('Franchise settlement not found');
    }
    // Allow a FAILED payout to be retried (mirrors the seller flow), not only a
    // fresh APPROVED one.
    if (settlement.status !== 'APPROVED' && settlement.status !== 'FAILED') {
      throw new BadRequestAppException(
        `Cannot mark as paid. Settlement status is ${settlement.status}. Only APPROVED or FAILED settlements can be marked as paid.`,
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
    // Phase 250 (Franchise tax) — the ACTUAL amount wired = net payable minus the
    // withheld statutory taxes (commission-GST + TCS + TDS), floored at 0.
    // Mirrors the seller markSettlementPaid. Pre-250 paidAmountInPaise was never
    // written, so aging/reconciliation read every franchise payout as ₹0 paid.
    const grossPaise = BigInt(
      new Prisma.Decimal(settlement.netPayableToFranchise).mul(100).toFixed(0),
    );
    // Phase 251 — single source of truth (settlement-net.ts), shared with the
    // seller side. Already clamped ≥0.
    const paidAmountInPaise = settlementNetFromRow(settlement, grossPaise);
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const flip = await tx.franchiseSettlement.updateMany({
          // APPROVED → PAID, or a retry of a FAILED payout.
          where: { id: settlementId, status: { in: ['APPROVED', 'FAILED'] } },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            paymentReference,
            paymentMethod: paymentMethod ?? null,
            paymentProofUrl: paymentProofUrl ?? null,
            paidByAdminId: paidByAdminId ?? null,
            paidAmountInPaise,
          },
        });
        if (flip.count !== 1) {
          throw new BadRequestAppException(
            'Settlement is no longer APPROVED/FAILED (it may have just been paid by a concurrent request). No payment was recorded.',
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
    } catch (err) {
      // Unique violation on payment_reference — this UTR is already recorded
      // against another settlement (duplicate money-out detection).
      if ((err as { code?: string })?.code === 'P2002') {
        throw new BadRequestAppException(
          `Payment reference "${paymentReference}" is already recorded against another settlement.`,
        );
      }
      throw err;
    }

    // Phase 250 (Franchise tax) — flip the §194-O TDS ledger COMPUTED → WITHHELD
    // now the franchise has been paid (the TDS was withheld from the payout).
    // Best-effort, post-commit (re-runnable via admin if it fails).
    try {
      await this.tcsHook.markCollectedOnPayFranchise({ settlementId });
    } catch (err) {
      this.logger.error(
        `§52 TCS mark-collected failed for franchise settlement ${settlementId}: ${(err as Error).message}`,
      );
    }
    try {
      await this.tdsHook.markWithheldOnPayFranchise({ settlementId });
    } catch (err) {
      this.logger.error(
        `194-O TDS mark-withheld failed for franchise settlement ${settlementId}: ${(err as Error).message}`,
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
