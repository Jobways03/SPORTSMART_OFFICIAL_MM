// Phase 27 — SettlementTds194OHookService.
//
// Bridges the SettlementsModule to the Section 194-O TDS lifecycle.
// Called from SettlementService at the same two lifecycle points as
// the existing SettlementTcsHookService:
//
//   applyToCycleOnApprove(cycleId, actorId?)
//     For every SellerSettlement in the cycle, computes the TDS for
//     the seller's quarterly filing period (per the cycle's periodEnd)
//     via Tds194OService.computeForSeller and stamps the
//     SellerSettlement with tdsLedgerId + tdsDeductedInPaise +
//     tdsRateBpsSnapshot. Sellers flagged is194OExempt and sellers
//     with no activity in the quarter are skipped without erroring.
//
//   markWithheldOnPay(settlementId)
//     Flips the linked TDS ledger row COMPUTED → WITHHELD when the
//     settlement is paid. The TDS amount has been deducted from the
//     seller's payout and is now waiting for the admin to file the
//     challan + issue Form 16A.
//
// Per-settlement failure is captured (logged + failed list returned)
// so a single seller's compute failure doesn't roll back the entire
// cycle's TCS/TDS stamping.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { Tds194OService } from './tds-194o.service';
import { TaxConfigService } from './tax-config.service';

export interface ApplyToCycleResult {
  cycleId: string;
  settlementsProcessed: number;
  settlementsSkipped: number;
  settlementsExempt: number;
  settlementsFailed: number;
  failedSettlementIds: string[];
  totalTdsDeductedInPaise: bigint;
  filingPeriod: string;
}

@Injectable()
export class SettlementTds194OHookService {
  private readonly logger = new Logger(SettlementTds194OHookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tds: Tds194OService,
    // Phase 252 — per-settlement TDS slice uses the configured base (commission
    // vs product) so it reconciles with the quarterly Form-26Q aggregate.
    private readonly taxConfig: TaxConfigService,
  ) {}

  /**
   * Apply Section 194-O TDS to every SellerSettlement in the cycle.
   * Returns aggregate counts. Mirrors the TCS hook signature.
   */
  async applyToCycleOnApprove(args: {
    cycleId: string;
    actorId?: string;
  }): Promise<ApplyToCycleResult> {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: args.cycleId },
      select: { id: true, periodEnd: true },
    });
    if (!cycle) {
      throw new Error(`SettlementCycle ${args.cycleId} not found`);
    }

    const filingPeriod = Tds194OService.filingPeriodOf(cycle.periodEnd);

    // Master toggle — when §194-O TDS is switched OFF in the settlement tax
    // config, skip the cycle entirely: no Form-26Q ledger, no per-settlement
    // stamp, nothing to show. Already-stamped settlements keep their figures.
    if (!(await this.taxConfig.getSettlementTaxConfig()).tds.enabled) {
      this.logger.log(
        `TDS disabled in settlement tax config — skipping cycle ${args.cycleId}`,
      );
      return {
        cycleId: args.cycleId,
        settlementsProcessed: 0,
        settlementsSkipped: 0,
        settlementsExempt: 0,
        settlementsFailed: 0,
        failedSettlementIds: [],
        totalTdsDeductedInPaise: 0n,
        filingPeriod,
      };
    }

    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { cycleId: args.cycleId },
      select: {
        id: true,
        sellerId: true,
        tdsLedgerId: true,
      },
    });

    let processed = 0;
    let skipped = 0;
    let exempt = 0;
    let total = 0n;
    const failedSettlementIds: string[] = [];
    for (const s of settlements) {
      if (s.tdsLedgerId) {
        // Idempotent — already stamped on a prior approval pass.
        skipped++;
        continue;
      }
      try {
        const result = await this.tds.computeForSeller({
          sellerId: s.sellerId,
          filingPeriod,
          computedBy: args.actorId,
          computedReason:
            `Settlement cycle ${cycle.id} approved → ` +
            `194-O filing period ${filingPeriod}`,
        });

        if (result.skipped) {
          if (result.skipReason === 'EXEMPT') exempt++;
          else skipped++;
          // Phase 161 (audit #17) — persist WHY no TDS row was written so
          // finance reports can query exempt-vs-no-activity without re-deriving.
          await this.prisma.sellerSettlement.update({
            where: { id: s.id },
            data: { tdsSkipReason: result.skipReason ?? 'NO_ACTIVITY' },
          });
          continue;
        }

        const ledger = result.ledger!;

        // Per-settlement TDS = rate × THIS settlement's OWN net gross sale
        // (its totalPlatformAmount incl GST, less its own negative refund/
        // clawback adjustments). Pre-fix this stamped the whole quarter's TDS
        // (ledger.tdsInPaise) on every settlement, so a seller settled multiple
        // times in a quarter was withheld the full quarterly TDS on each
        // payout. Each settlement now bears only its own slice; summed across
        // the quarter's settlements it reconciles to the quarterly ledger (the
        // Form 26Q deposit figure). Mirrors SettlementTcsHookService.
        const perSettlementTdsInPaise = await this.computeSettlementTds(
          s.id,
          ledger.tdsRateBps,
        );

        await this.prisma.sellerSettlement.update({
          where: { id: s.id },
          data: {
            tdsLedgerId: ledger.id,
            tdsDeductedInPaise: perSettlementTdsInPaise,
            tdsRateBpsSnapshot: ledger.tdsRateBps,
            tdsFilingPeriod: filingPeriod,
          },
        });
        total += perSettlementTdsInPaise;
        processed++;
      } catch (err) {
        failedSettlementIds.push(s.id);
        this.logger.error(
          `Section 194-O TDS compute failed for settlement ${s.id} ` +
            `(seller ${s.sellerId}): ${(err as Error).message} — ` +
            `settlement left WITHOUT tdsLedgerId; finance must re-run via admin endpoint.`,
        );
      }
    }

    if (failedSettlementIds.length > 0) {
      this.logger.error(
        `194-O TDS apply-on-approve cycle ${args.cycleId} had ` +
          `${failedSettlementIds.length} failed settlement(s): ` +
          `${failedSettlementIds.join(', ')}`,
      );
    }
    this.logger.log(
      `194-O TDS applied to cycle ${args.cycleId}: processed=${processed} ` +
        `skipped=${skipped} exempt=${exempt} failed=${failedSettlementIds.length} ` +
        `total=${total.toString()} period=${filingPeriod}`,
    );
    return {
      cycleId: args.cycleId,
      settlementsProcessed: processed,
      settlementsSkipped: skipped,
      settlementsExempt: exempt,
      settlementsFailed: failedSettlementIds.length,
      failedSettlementIds,
      totalTdsDeductedInPaise: total,
      filingPeriod,
    };
  }

  /**
   * Phase 253 — reverse the §194-O TDS ledgers stamped on a cycle's settlements
   * when an APPROVED (unpaid) cycle is rejected, so a fresh cycle recomputes
   * cleanly. The ledger is a quarterly Form-26Q aggregate; reversing it assumes
   * this cycle is the only one in the quarter (the redo flow). Best-effort.
   */
  async reverseCycleOnCancel(
    cycleId: string,
    reversedBy: string,
    reason: string,
  ): Promise<number> {
    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { cycleId, tdsLedgerId: { not: null } },
      select: { tdsLedgerId: true },
    });
    const ledgerIds = [
      ...new Set(
        settlements
          .map((s) => s.tdsLedgerId)
          .filter((x): x is string => !!x),
      ),
    ];
    let reversed = 0;
    for (const ledgerId of ledgerIds) {
      try {
        await this.tds.reverse({
          ledgerId,
          reversedBy,
          reason: `Cycle ${cycleId} rejected: ${reason}`,
        });
        reversed++;
      } catch (e) {
        this.logger.warn(
          `TDS ledger ${ledgerId} reverse failed: ${(e as Error).message}`,
        );
      }
    }
    return reversed;
  }

  /**
   * TDS attributable to a SINGLE settlement = rate × this settlement's own
   * configured base (less its own negative refund/clawback adjustments,
   * clamped at zero). This is the amount deducted from THIS payout — distinct
   * from the quarterly Section194OTdsLedger.tdsInPaise (Form 26Q).
   */
  private async computeSettlementTds(
    settlementId: string,
    rateBps: number,
  ): Promise<bigint> {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
      select: {
        totalPlatformAmountInPaise: true,
        totalPlatformMarginInPaise: true,
        adjustments: { select: { amountInPaise: true } },
      },
    });
    if (!settlement) return 0n;

    // Phase 252 — use the CONFIGURED base column (same as the quarterly
    // aggregate) so the slice reconciles to the Form-26Q ledger.
    const tdsCfg = (await this.taxConfig.getSettlementTaxConfig()).tds;
    const baseInPaise =
      tdsCfg.baseType === 'COMMISSION'
        ? settlement.totalPlatformMarginInPaise
        : settlement.totalPlatformAmountInPaise;

    // Negative adjustments = refunds / clawbacks; sum their magnitudes as
    // the refund reversal, matching the quarterly aggregation. Positive
    // adjustments are already inside the base column.
    let refundReversalInPaise = 0n;
    for (const adj of settlement.adjustments) {
      if (adj.amountInPaise < 0n) refundReversalInPaise += -adj.amountInPaise;
    }
    const netSaleInPaise = baseInPaise - refundReversalInPaise;
    if (netSaleInPaise <= 0n) return 0n;
    // rate in basis points (100 = 1%); round half-up — same as the
    // tds-194o-calculator's mulBpsRoundHalfAway for positive values and the
    // TCS slice.
    return (netSaleInPaise * BigInt(rateBps) + 5000n) / 10000n;
  }

  /**
   * Phase 250 (Franchise tax) — apply §194-O TDS to ONE FranchiseSettlement at
   * approval time. The franchise flow approves one settlement at a time (unlike
   * the seller's whole-cycle approve), so this is the per-settlement entry
   * point. Idempotent: a settlement already carrying a tdsLedgerId is skipped.
   * Computes the franchise's quarterly ledger (idempotent) and stamps THIS
   * settlement's own per-settlement slice. Base = online gross only.
   */
  async applyToFranchiseSettlementOnApprove(args: {
    settlementId: string;
    actorId?: string;
  }): Promise<{ stamped: boolean; skipped: boolean; tdsInPaise: bigint }> {
    const s = await this.prisma.franchiseSettlement.findUnique({
      where: { id: args.settlementId },
      select: {
        id: true,
        franchiseId: true,
        tdsLedgerId: true,
        cycle: { select: { periodEnd: true } },
      },
    });
    if (!s) {
      throw new Error(`FranchiseSettlement ${args.settlementId} not found`);
    }
    if (s.tdsLedgerId) {
      // Idempotent — already stamped on a prior approval pass.
      return { stamped: false, skipped: true, tdsInPaise: 0n };
    }

    const filingPeriod = Tds194OService.filingPeriodOf(s.cycle.periodEnd);
    const result = await this.tds.computeForFranchise({
      franchiseId: s.franchiseId,
      filingPeriod,
      computedBy: args.actorId,
      computedReason:
        `Franchise settlement ${s.id} approved → 194-O filing period ${filingPeriod}`,
    });

    if (result.skipped) {
      await this.prisma.franchiseSettlement.update({
        where: { id: s.id },
        data: { tdsSkipReason: result.skipReason ?? 'NO_ACTIVITY' },
      });
      return { stamped: false, skipped: true, tdsInPaise: 0n };
    }

    const ledger = result.ledger!;
    const perSettlementTdsInPaise = await this.computeFranchiseSettlementTds(
      s.id,
      ledger.tdsRateBps,
    );
    await this.prisma.franchiseSettlement.update({
      where: { id: s.id },
      data: {
        tdsLedgerId: ledger.id,
        tdsDeductedInPaise: perSettlementTdsInPaise,
        tdsRateBpsSnapshot: ledger.tdsRateBps,
        tdsFilingPeriod: filingPeriod,
      },
    });
    return { stamped: true, skipped: false, tdsInPaise: perSettlementTdsInPaise };
  }

  /**
   * Batch variant — apply §194-O TDS to every FranchiseSettlement in a cycle by
   * delegating to the per-settlement entry point. Available for a future
   * cycle-level franchise approve; today the live path is per-settlement.
   */
  async applyToFranchiseCycleOnApprove(args: {
    cycleId: string;
    actorId?: string;
  }): Promise<ApplyToCycleResult> {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: args.cycleId },
      select: { id: true, periodEnd: true },
    });
    if (!cycle) {
      throw new Error(`SettlementCycle ${args.cycleId} not found`);
    }
    const filingPeriod = Tds194OService.filingPeriodOf(cycle.periodEnd);
    const settlements = await this.prisma.franchiseSettlement.findMany({
      where: { cycleId: args.cycleId },
      select: { id: true },
    });

    let processed = 0;
    let skipped = 0;
    let total = 0n;
    const failedSettlementIds: string[] = [];
    for (const s of settlements) {
      try {
        const r = await this.applyToFranchiseSettlementOnApprove({
          settlementId: s.id,
          actorId: args.actorId,
        });
        if (r.stamped) {
          processed++;
          total += r.tdsInPaise;
        } else {
          skipped++;
        }
      } catch (err) {
        failedSettlementIds.push(s.id);
        this.logger.error(
          `Section 194-O TDS compute failed for franchise settlement ${s.id}: ` +
            `${(err as Error).message} — left WITHOUT tdsLedgerId; finance must re-run.`,
        );
      }
    }

    this.logger.log(
      `194-O TDS applied to FRANCHISE cycle ${args.cycleId}: processed=${processed} ` +
        `skipped=${skipped} failed=${failedSettlementIds.length} ` +
        `total=${total.toString()} period=${filingPeriod}`,
    );
    return {
      cycleId: args.cycleId,
      settlementsProcessed: processed,
      settlementsSkipped: skipped,
      settlementsExempt: 0,
      settlementsFailed: failedSettlementIds.length,
      failedSettlementIds,
      totalTdsDeductedInPaise: total,
      filingPeriod,
    };
  }

  /**
   * Franchise per-settlement TDS slice = rate × this settlement's OWN online
   * gross (totalOnlineAmount less reversalAmount, clamped at 0). Mirrors the
   * seller computeSettlementTds; summed across the quarter's franchise
   * settlements it reconciles to the quarterly franchise ledger.
   */
  private async computeFranchiseSettlementTds(
    settlementId: string,
    rateBps: number,
  ): Promise<bigint> {
    const s = await this.prisma.franchiseSettlement.findUnique({
      where: { id: settlementId },
      select: {
        totalOnlineAmount: true,
        totalOnlineCommission: true,
        reversalAmount: true,
      },
    });
    if (!s) return 0n;
    // Phase 252 — configured base column (commission vs product), matching the
    // quarterly franchise aggregate.
    const tdsCfg = (await this.taxConfig.getSettlementTaxConfig()).tds;
    const baseDecimal =
      tdsCfg.baseType === 'COMMISSION'
        ? s.totalOnlineCommission
        : s.totalOnlineAmount;
    const netSaleInPaise =
      BigInt(baseDecimal.mul(100).toFixed(0)) -
      BigInt(s.reversalAmount.mul(100).toFixed(0));
    if (netSaleInPaise <= 0n) return 0n;
    return (netSaleInPaise * BigInt(rateBps) + 5000n) / 10000n;
  }

  /**
   * Mark the TDS ledger row COMPUTED → WITHHELD when its linked
   * SellerSettlement is paid. Idempotent.
   */
  async markWithheldOnPay(args: {
    settlementId: string;
  }): Promise<{ ledgerId: string | null; flipped: boolean }> {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: args.settlementId },
      select: { tdsLedgerId: true },
    });
    if (!settlement?.tdsLedgerId) {
      // Exempt seller, no-activity period, or pre-Phase-27 settlement.
      return { ledgerId: null, flipped: false };
    }
    const before = await this.prisma.section194OTdsLedger.findUnique({
      where: { id: settlement.tdsLedgerId },
      select: { status: true },
    });
    if (!before) {
      this.logger.warn(
        `Settlement ${args.settlementId} references missing 194-O TDS ` +
          `ledger ${settlement.tdsLedgerId} — orphan link, skipping ` +
          `mark-withheld.`,
      );
      return { ledgerId: settlement.tdsLedgerId, flipped: false };
    }
    if (before.status !== 'COMPUTED') {
      // Already withheld / deposited / certificate-issued — no-op.
      return { ledgerId: settlement.tdsLedgerId, flipped: false };
    }
    await this.tds.markWithheld({
      ledgerId: settlement.tdsLedgerId,
      settlementId: args.settlementId,
    });
    return { ledgerId: settlement.tdsLedgerId, flipped: true };
  }

  /**
   * Phase 250 (Franchise tax) — flip the linked TDS ledger COMPUTED → WITHHELD
   * when a FranchiseSettlement is paid. Mirrors markWithheldOnPay (seller).
   */
  async markWithheldOnPayFranchise(args: {
    settlementId: string;
  }): Promise<{ ledgerId: string | null; flipped: boolean }> {
    const settlement = await this.prisma.franchiseSettlement.findUnique({
      where: { id: args.settlementId },
      select: { tdsLedgerId: true },
    });
    if (!settlement?.tdsLedgerId) {
      return { ledgerId: null, flipped: false };
    }
    const before = await this.prisma.section194OTdsLedger.findUnique({
      where: { id: settlement.tdsLedgerId },
      select: { status: true },
    });
    if (!before) {
      this.logger.warn(
        `Franchise settlement ${args.settlementId} references missing 194-O TDS ` +
          `ledger ${settlement.tdsLedgerId} — orphan link, skipping mark-withheld.`,
      );
      return { ledgerId: settlement.tdsLedgerId, flipped: false };
    }
    if (before.status !== 'COMPUTED') {
      return { ledgerId: settlement.tdsLedgerId, flipped: false };
    }
    await this.tds.markWithheld({
      ledgerId: settlement.tdsLedgerId,
      settlementId: args.settlementId,
    });
    return { ledgerId: settlement.tdsLedgerId, flipped: true };
  }

  /**
   * Effective payout amount =
   *   totalSettlement
   *   − tcsDeducted             (Section 52 CGST — collected for govt)
   *   − tdsDeducted             (Section 194-O IT — collected for govt)
   *   − totalCommissionGst      (Section 9 CGST — owed by platform on
   *                              commission service; withheld from
   *                              payout, claimable as ITC by seller)
   *
   * Helper for the payout-statement renderer; pure arithmetic.
   */
  static computeNetPayoutInPaise(settlement: {
    totalSettlementAmountInPaise: bigint;
    tcsDeductedInPaise: bigint;
    tdsDeductedInPaise: bigint;
    totalCommissionGstInPaise: bigint;
  }): bigint {
    return (
      settlement.totalSettlementAmountInPaise -
      settlement.tcsDeductedInPaise -
      settlement.tdsDeductedInPaise -
      settlement.totalCommissionGstInPaise
    );
  }
}
