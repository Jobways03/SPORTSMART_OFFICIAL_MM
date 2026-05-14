// Phase 17 GST — SettlementTcsHookService.
//
// Bridges the SettlementsModule to the TCS lifecycle. Called from
// SettlementService at two points:
//
//   applyToCycleOnApprove(cycleId, actorId?)
//     For every SellerSettlement in the cycle, computes the TCS for
//     the seller's filing period (per the cycle's periodEnd) via
//     TcsService.computeForSeller, then stamps the SellerSettlement
//     row with the ledger ID + deducted paise + rate snapshot. Does
//     NOT change the TCS row's status — it stays COMPUTED until the
//     individual settlement is marked PAID.
//
//   markCollectedOnPay(settlementId, ...)
//     Called from SettlementService.markSettlementPaid. Flips the
//     linked TCS ledger row COMPUTED → COLLECTED so the GSTR-8 export
//     knows the money has actually moved.
//
// Idempotency:
//   - applyToCycleOnApprove skips settlements that already carry a
//     tcsLedgerId.
//   - markCollectedOnPay relies on TcsService.markCollected's own
//     idempotency (already-COLLECTED is a no-op).
//
// The filing period is derived from the cycle's `periodEnd` so a
// cycle that spans into the next month files the TCS in the LATER
// month. CA decision §3 confirms this — see TCS_POLICY.md §4 and
// CA.md row 11.
//
// See:
//   - docs/tax/TCS_POLICY.md §4 (computation timing)
//   - apps/api/src/modules/tax/application/services/tcs.service.ts

import { Injectable, Logger } from '@nestjs/common';
import type { SellerSettlement } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { TcsService } from './tcs.service';

export interface ApplyToCycleResult {
  cycleId: string;
  settlementsProcessed: number;
  settlementsSkipped: number;
  totalTcsDeductedInPaise: bigint;
  filingPeriod: string;
}

@Injectable()
export class SettlementTcsHookService {
  private readonly logger = new Logger(SettlementTcsHookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tcs: TcsService,
  ) {}

  /**
   * Apply TCS to every SellerSettlement in the cycle. Returns
   * aggregate counts for the admin response.
   *
   * Per TCS_POLICY §4: TCS is computed at settlement-run time, not at
   * invoice issuance. This hook is the canonical implementation of
   * that rule.
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

    const filingPeriod = TcsService.filingPeriodOf(cycle.periodEnd);
    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { cycleId: args.cycleId },
      select: {
        id: true,
        sellerId: true,
        tcsLedgerId: true,
        totalSettlementAmountInPaise: true,
      },
    });

    let processed = 0;
    let skipped = 0;
    let total = 0n;
    for (const s of settlements) {
      if (s.tcsLedgerId) {
        // Idempotent — already stamped on a prior run.
        skipped++;
        continue;
      }
      try {
        const { ledger } = await this.tcs.computeForSeller({
          sellerId: s.sellerId,
          filingPeriod,
          computedBy: args.actorId,
          computedReason:
            `Settlement cycle ${cycle.id} approved → filing period ${filingPeriod}`,
        });

        await this.prisma.sellerSettlement.update({
          where: { id: s.id },
          data: {
            tcsLedgerId: ledger.id,
            tcsDeductedInPaise: ledger.totalTcsInPaise,
            tcsRateBpsSnapshot: ledger.tcsRateBps,
            tcsFilingPeriod: filingPeriod,
          },
        });
        total += ledger.totalTcsInPaise;
        processed++;
      } catch (err) {
        this.logger.warn(
          `TCS compute failed for settlement ${s.id} (seller ${s.sellerId}): ` +
            `${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `TCS applied to cycle ${args.cycleId}: processed=${processed} ` +
        `skipped=${skipped} total=${total.toString()} period=${filingPeriod}`,
    );
    return {
      cycleId: args.cycleId,
      settlementsProcessed: processed,
      settlementsSkipped: skipped,
      totalTcsDeductedInPaise: total,
      filingPeriod,
    };
  }

  /**
   * Mark the TCS ledger row COMPUTED → COLLECTED when its linked
   * SellerSettlement is paid. Idempotent.
   */
  async markCollectedOnPay(args: {
    settlementId: string;
  }): Promise<{ ledgerId: string | null; flipped: boolean }> {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: args.settlementId },
      select: { tcsLedgerId: true },
    });
    if (!settlement?.tcsLedgerId) {
      // Settlement was approved before Phase 17 wired the hook, or
      // the TCS amount was zero (skip column never set). Nothing to do.
      return { ledgerId: null, flipped: false };
    }

    const before = await this.prisma.gstTcsSettlementLedger.findUnique({
      where: { id: settlement.tcsLedgerId },
      select: { status: true },
    });
    if (!before) {
      this.logger.warn(
        `Settlement ${args.settlementId} references missing TCS ledger ` +
          `${settlement.tcsLedgerId} — orphan link, skipping mark-collected.`,
      );
      return { ledgerId: settlement.tcsLedgerId, flipped: false };
    }
    if (before.status !== 'COMPUTED') {
      // Already COLLECTED/FILED/PAID_TO_GOVT — idempotent skip.
      return { ledgerId: settlement.tcsLedgerId, flipped: false };
    }

    await this.tcs.markCollected({
      ledgerId: settlement.tcsLedgerId,
      settlementId: args.settlementId,
    });
    return { ledgerId: settlement.tcsLedgerId, flipped: true };
  }

  /**
   * Effective payout amount = totalSettlement - tcsDeducted. Helper
   * for the payout-statement renderer; pure arithmetic so the seller
   * UI doesn't have to re-derive it.
   */
  static computeNetPayoutInPaise(settlement: {
    totalSettlementAmountInPaise: bigint;
    tcsDeductedInPaise: bigint;
  }): bigint {
    return (
      settlement.totalSettlementAmountInPaise - settlement.tcsDeductedInPaise
    );
  }
}
