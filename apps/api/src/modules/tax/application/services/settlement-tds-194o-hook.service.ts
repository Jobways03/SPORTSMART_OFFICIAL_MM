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
          continue;
        }

        const ledger = result.ledger!;
        await this.prisma.sellerSettlement.update({
          where: { id: s.id },
          data: {
            tdsLedgerId: ledger.id,
            tdsDeductedInPaise: ledger.tdsInPaise,
            tdsRateBpsSnapshot: ledger.tdsRateBps,
            tdsFilingPeriod: filingPeriod,
          },
        });
        total += ledger.tdsInPaise;
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
