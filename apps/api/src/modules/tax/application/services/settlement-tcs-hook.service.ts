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
import { Prisma } from '@prisma/client';
import type { SellerSettlement } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { TcsService } from './tcs.service';
import { TaxConfigService } from './tax-config.service';
import { resolveTaxBaseInPaise } from '../../domain/settlement-tax-config';

export interface ApplyToCycleResult {
  cycleId: string;
  settlementsProcessed: number;
  settlementsSkipped: number;
  settlementsFailed: number;
  /** IDs of the settlements that raised; ops scrapes these from the
   *  log + retries via the admin "re-run TCS for cycle" endpoint. */
  failedSettlementIds: string[];
  totalTcsDeductedInPaise: bigint;
  filingPeriod: string;
}

@Injectable()
export class SettlementTcsHookService {
  private readonly logger = new Logger(SettlementTcsHookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tcs: TcsService,
    // Phase 252 — TCS base ('what it's levied on') is configurable; default GST.
    private readonly taxConfig: TaxConfigService,
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

    // Master toggle — when §52 TCS is switched OFF in the settlement tax config,
    // skip the cycle entirely: no GSTR-8 ledger, no per-settlement stamp,
    // nothing to show. Already-stamped settlements keep their figures.
    if (!(await this.taxConfig.getSettlementTaxConfig()).tcs.enabled) {
      this.logger.log(
        `TCS disabled in settlement tax config — skipping cycle ${args.cycleId}`,
      );
      return {
        cycleId: args.cycleId,
        settlementsProcessed: 0,
        settlementsSkipped: 0,
        settlementsFailed: 0,
        failedSettlementIds: [],
        totalTcsDeductedInPaise: 0n,
        filingPeriod,
      };
    }

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
    const failedSettlementIds: string[] = [];
    for (const s of settlements) {
      if (s.tcsLedgerId) {
        // Idempotent — already stamped on a prior run.
        skipped++;
        continue;
      }
      try {
        // Monthly GSTR-8 ledger — the figure deposited ONCE for the seller's
        // whole filing period. This is the reporting aggregate, NOT the amount
        // deducted from this single settlement.
        const { ledger } = await this.tcs.computeForSeller({
          sellerId: s.sellerId,
          filingPeriod,
          computedBy: args.actorId,
          computedReason:
            `Settlement cycle ${cycle.id} approved → filing period ${filingPeriod}`,
        });

        // Per-settlement TCS = rate × THIS settlement's OWN taxable supply (its
        // orders' tax-invoice taxable value). Pre-fix this stamped the whole
        // month's TCS (ledger.totalTcsInPaise) on every settlement, so a seller
        // settled weekly was charged the full monthly TCS on each weekly
        // payout. Now each settlement bears only its own slice; summed across
        // the period's settlements it reconciles to the monthly ledger.
        const perSettlementTcsInPaise = await this.computeSettlementTcs(
          s.id,
          ledger.tcsRateBps,
        );

        await this.prisma.sellerSettlement.update({
          where: { id: s.id },
          data: {
            tcsLedgerId: ledger.id,
            tcsDeductedInPaise: perSettlementTcsInPaise,
            tcsRateBpsSnapshot: ledger.tcsRateBps,
            tcsFilingPeriod: filingPeriod,
          },
        });
        total += perSettlementTcsInPaise;
        processed++;
      } catch (err) {
        // Per-settlement failure is captured so the caller can see the
        // gap. The cycle approval is NOT rolled back — the failed
        // settlement just sits without a tcsLedgerId; finance can
        // re-run targeted compute. The previous version silently
        // swallowed this and the caller's processed+skipped didn't
        // sum to settlements.length — ops never knew there was a gap.
        failedSettlementIds.push(s.id);
        this.logger.error(
          `TCS compute failed for settlement ${s.id} (seller ${s.sellerId}): ` +
            `${(err as Error).message} — settlement left WITHOUT tcsLedgerId; ` +
            `finance must re-run via admin endpoint.`,
        );
      }
    }

    if (failedSettlementIds.length > 0) {
      this.logger.error(
        `TCS apply-on-approve cycle ${args.cycleId} had ${failedSettlementIds.length} ` +
          `failed settlement(s): ${failedSettlementIds.join(', ')}`,
      );
    }
    this.logger.log(
      `TCS applied to cycle ${args.cycleId}: processed=${processed} ` +
        `skipped=${skipped} failed=${failedSettlementIds.length} ` +
        `total=${total.toString()} period=${filingPeriod}`,
    );
    return {
      cycleId: args.cycleId,
      settlementsProcessed: processed,
      settlementsSkipped: skipped,
      settlementsFailed: failedSettlementIds.length,
      failedSettlementIds,
      totalTcsDeductedInPaise: total,
      filingPeriod,
    };
  }

  /**
   * Phase 253 — reverse the §52 TCS ledgers stamped on a cycle's settlements
   * when an APPROVED (unpaid) cycle is rejected, so a fresh cycle recomputes
   * cleanly. The ledger is a monthly GSTR-8 aggregate; reversing it assumes this
   * cycle is the only one in the filing month (the redo flow). Best-effort.
   */
  async reverseCycleOnCancel(
    cycleId: string,
    reversedBy: string,
    reason: string,
  ): Promise<number> {
    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { cycleId, tcsLedgerId: { not: null } },
      select: { tcsLedgerId: true },
    });
    const ledgerIds = [
      ...new Set(
        settlements
          .map((s) => s.tcsLedgerId)
          .filter((x): x is string => !!x),
      ),
    ];
    let reversed = 0;
    for (const ledgerId of ledgerIds) {
      try {
        const r = await this.tcs.reverse({
          ledgerId,
          reversedBy,
          reason: `Cycle ${cycleId} rejected: ${reason}`,
        });
        if (!r.wasAlreadyReversed) reversed++;
      } catch (e) {
        this.logger.warn(
          `TCS ledger ${ledgerId} reverse failed: ${(e as Error).message}`,
        );
      }
    }
    return reversed;
  }

  /**
   * TCS attributable to a SINGLE settlement = rate × the configured base for
   * that settlement. This is the amount deducted from THIS payout — distinct
   * from the monthly GSTR-8 ledger total (deposited to the government once for
   * the whole period).
   */
  private async computeSettlementTcs(
    settlementId: string,
    rateBps: number,
  ): Promise<bigint> {
    // Phase 253 (CA-approved model) — TCS slice on the CONFIGURED base, computed
    // from the settlement's own columns so it reconciles with the monthly ledger.
    // Default base = TAXABLE_SUPPLY (the net taxable value of the supplies, ex-
    // GST), i.e. the legally-correct §52 base: 1% × ₹4761.90 = ₹47.62 on a ₹5000
    // incl @5% sale. totalTaxableSupplyInPaise is stamped at cycle creation from
    // each line's OrderItemTaxSnapshot — the SAME taxable the monthly GSTR-8
    // ledger uses, so Σ(per-settlement slices) reconciles to the monthly deposit.
    // (The legacy 'GST' base levied 1% on the tiny commission-GST figure, under-
    // withholding while the ledger correctly deposited 1% of the taxable supply.)
    const cfg = (await this.taxConfig.getSettlementTaxConfig()).tcs;
    const s = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
      select: {
        totalPlatformMarginInPaise: true,
        totalPlatformAmountInPaise: true,
        totalCommissionGstInPaise: true,
        totalTaxableSupplyInPaise: true,
      },
    });
    if (!s) return 0n;
    const base = resolveTaxBaseInPaise(cfg.baseType, {
      commissionInPaise: s.totalPlatformMarginInPaise,
      priceOfGoodsSoldInPaise: s.totalPlatformAmountInPaise,
      gstInPaise: s.totalCommissionGstInPaise,
      taxableSupplyInPaise: s.totalTaxableSupplyInPaise,
    });
    if (base <= 0n) return 0n;
    // rate is in basis points (100 = 1%); round half-up.
    return (base * BigInt(rateBps) + 5000n) / 10000n;
  }

  /**
   * Phase 250 (Franchise tax) — apply §52 TCS to ONE FranchiseSettlement at
   * approval (the franchise flow approves one at a time). Computes the
   * franchise's monthly ledger (idempotent) and stamps THIS settlement's own
   * per-settlement slice. Base = the franchise's ONLINE tax invoices only.
   */
  async applyToFranchiseSettlementOnApprove(args: {
    settlementId: string;
    actorId?: string;
  }): Promise<{ stamped: boolean; skipped: boolean; tcsInPaise: bigint }> {
    const s = await this.prisma.franchiseSettlement.findUnique({
      where: { id: args.settlementId },
      select: {
        id: true,
        franchiseId: true,
        tcsLedgerId: true,
        cycle: { select: { periodEnd: true } },
      },
    });
    if (!s) {
      throw new Error(`FranchiseSettlement ${args.settlementId} not found`);
    }
    if (s.tcsLedgerId) {
      // Idempotent — already stamped on a prior approval pass.
      return { stamped: false, skipped: true, tcsInPaise: 0n };
    }

    // Phase 253 — master toggle parity with the seller path (applyToCycleOnApprove
    // line ~89): when §52 TCS is OFF in the settlement tax config, skip the
    // franchise settlement entirely — no GSTR-8 ledger, no deduction. (The seller
    // path gated; the franchise path did not.)
    if (!(await this.taxConfig.getSettlementTaxConfig()).tcs.enabled) {
      return { stamped: false, skipped: true, tcsInPaise: 0n };
    }

    const filingPeriod = TcsService.filingPeriodOf(s.cycle.periodEnd);
    // Monthly GSTR-8 ledger (deposited once for the period). NOT the amount
    // deducted from this single settlement.
    const { ledger } = await this.tcs.computeForFranchise({
      franchiseId: s.franchiseId,
      filingPeriod,
      computedBy: args.actorId,
      computedReason:
        `Franchise settlement ${s.id} approved → filing period ${filingPeriod}`,
    });

    const { tcsInPaise: perSettlementTcsInPaise, taxableInPaise } =
      await this.computeFranchiseSettlementTcs(
        s.id,
        s.franchiseId,
        ledger.tcsRateBps,
      );
    await this.prisma.franchiseSettlement.update({
      where: { id: s.id },
      data: {
        tcsLedgerId: ledger.id,
        tcsDeductedInPaise: perSettlementTcsInPaise,
        tcsRateBpsSnapshot: ledger.tcsRateBps,
        tcsFilingPeriod: filingPeriod,
        // Phase 253 — stamp the §52 TCS base (net taxable supply) for the payout
        // statement + reconciliation, mirroring SellerSettlement.
        totalTaxableSupply: new Prisma.Decimal(taxableInPaise.toString())
          .div(100)
          .toFixed(2),
        totalTaxableSupplyInPaise: taxableInPaise,
      },
    });
    return { stamped: true, skipped: false, tcsInPaise: perSettlementTcsInPaise };
  }

  /**
   * Franchise per-settlement TCS slice = rate × the taxable value of THIS
   * settlement's ONLINE tax invoices. The settlement's online orders are the
   * sub-order ids on its ONLINE_ORDER finance-ledger entries (sourceId =
   * subOrderId); invoices + debit notes add, credit notes subtract. Same
   * document basis as the monthly franchise ledger so the slices reconcile.
   */
  private async computeFranchiseSettlementTcs(
    settlementId: string,
    franchiseId: string,
    rateBps: number,
  ): Promise<{ tcsInPaise: bigint; taxableInPaise: bigint }> {
    const entries = await this.prisma.franchiseFinanceLedger.findMany({
      where: { settlementBatchId: settlementId, sourceType: 'ONLINE_ORDER' },
      select: { sourceId: true },
    });
    const subOrderIds = entries
      .map((e) => e.sourceId)
      .filter((id): id is string => !!id);
    if (subOrderIds.length === 0)
      return { tcsInPaise: 0n, taxableInPaise: 0n };

    const docs = await this.prisma.taxDocument.findMany({
      where: {
        franchiseId,
        subOrderId: { in: subOrderIds },
        documentType: {
          in: [
            'TAX_INVOICE',
            'INVOICE_CUM_BILL_OF_SUPPLY',
            'DEBIT_NOTE',
            'CREDIT_NOTE',
          ],
        },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      select: { documentType: true, taxableAmountInPaise: true },
    });

    let taxable = 0n;
    for (const d of docs) {
      if (d.documentType === 'CREDIT_NOTE') taxable -= d.taxableAmountInPaise;
      else taxable += d.taxableAmountInPaise;
    }
    if (taxable <= 0n) return { tcsInPaise: 0n, taxableInPaise: 0n };
    return {
      tcsInPaise: (taxable * BigInt(rateBps) + 5000n) / 10000n,
      taxableInPaise: taxable,
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
   * Phase 250 (Franchise tax) — flip the §52 TCS ledger COMPUTED → COLLECTED
   * when a FranchiseSettlement is paid. Mirrors markCollectedOnPay (seller).
   */
  async markCollectedOnPayFranchise(args: {
    settlementId: string;
  }): Promise<{ ledgerId: string | null; flipped: boolean }> {
    const settlement = await this.prisma.franchiseSettlement.findUnique({
      where: { id: args.settlementId },
      select: { tcsLedgerId: true },
    });
    if (!settlement?.tcsLedgerId) {
      return { ledgerId: null, flipped: false };
    }
    const before = await this.prisma.gstTcsSettlementLedger.findUnique({
      where: { id: settlement.tcsLedgerId },
      select: { status: true },
    });
    if (!before) {
      this.logger.warn(
        `Franchise settlement ${args.settlementId} references missing TCS ledger ` +
          `${settlement.tcsLedgerId} — orphan link, skipping mark-collected.`,
      );
      return { ledgerId: settlement.tcsLedgerId, flipped: false };
    }
    if (before.status !== 'COMPUTED') {
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
