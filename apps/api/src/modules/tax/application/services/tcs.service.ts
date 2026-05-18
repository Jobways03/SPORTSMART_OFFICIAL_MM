// Phase 16 GST — TcsService.
//
// Owns the (sellerId, filingPeriod) TCS lifecycle:
//
//   computeForSeller({ sellerId, filingPeriod, ... })
//     Aggregates the seller's TAX_INVOICE + INVOICE_CUM_BILL_OF_SUPPLY
//     totals (gross taxable) minus CREDIT_NOTE totals (reversals) in
//     the period. Splits intra-state vs inter-state by comparing the
//     invoice's `sellerStateCode` vs `placeOfSupplyStateCode`.
//     Applies the prior-period carry-forward. Persists a row in
//     COMPUTED status; idempotent on re-call (returns the existing
//     COMPUTED/COLLECTED row).
//
//   markCollected({ ledgerId, settlementId })
//     Settlement-run hook. Stamps `collectedAt` + `settlementId`
//     and flips status COMPUTED → COLLECTED.
//
//   markFiled({ ledgerIds, filedBy })
//     Bulk transition COLLECTED → FILED after GSTR-8 upload to the
//     GSTN portal. Refuses to file COMPUTED rows (uncollected TCS
//     can't be filed) or already-FILED rows.
//
//   markPaidToGovt({ ledgerIds, paidBy, paymentReference })
//     Bulk transition FILED → PAID_TO_GOVT after government remittance.
//
//   reverse({ ledgerId, reason, reversedBy })
//     Correction flow. Creates a new REVERSED row pointing back via
//     correctionOfId. Caller is expected to follow up with a fresh
//     computeForSeller call to produce the corrected row.
//
// Per TCS_POLICY §2: only MARKETPLACE_SELLER + FRANCHISE supplier
// types are in scope. OWN_BRAND / SPORTSMART are excluded — we never
// write rows for them.
//
// See:
//   - docs/tax/TCS_POLICY.md
//   - apps/api/src/modules/tax/domain/tcs-calculator.ts

import { Injectable, Logger } from '@nestjs/common';
import type {
  GstTcsSettlementLedger,
  Prisma,
  TaxDocument,
  TcsStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { TaxConfigService } from './tax-config.service';
import {
  clampNetSupplyWithCarryForward,
  computeTcs,
  filingPeriodOf,
} from '../../domain/tcs-calculator';

export class TcsLedgerNotFoundError extends Error {
  constructor(public readonly ledgerId: string) {
    super(`GstTcsSettlementLedger ${ledgerId} not found`);
    this.name = 'TcsLedgerNotFoundError';
  }
}

export class TcsInvalidTransitionError extends Error {
  constructor(
    public readonly ledgerId: string,
    public readonly from: TcsStatus,
    public readonly to: TcsStatus,
  ) {
    super(
      `GstTcsSettlementLedger ${ledgerId} cannot transition ${from} → ${to}`,
    );
    this.name = 'TcsInvalidTransitionError';
  }
}

export interface ComputeForSellerArgs {
  sellerId: string;
  filingPeriod: string; // "YYYY-MM"
  computedBy?: string;
  computedReason?: string;
}

export interface ComputeResult {
  ledger: GstTcsSettlementLedger;
  isNew: boolean;
}

@Injectable()
export class TcsService {
  private readonly logger = new Logger(TcsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxConfig: TaxConfigService,
  ) {}

  /** Convenience: surface the filing-period helper to callers. */
  static filingPeriodOf(date: Date): string {
    return filingPeriodOf(date);
  }

  /**
   * Idempotently compute (or return existing) TCS row for one
   * (seller, filing-period) pair.
   */
  async computeForSeller(args: ComputeForSellerArgs): Promise<ComputeResult> {
    const existing = await this.prisma.gstTcsSettlementLedger.findFirst({
      where: {
        sellerId: args.sellerId,
        filingPeriod: args.filingPeriod,
        status: { not: 'REVERSED' },
      },
    });
    if (existing) {
      // Idempotent — return the active row as-is. Recomputation after
      // FILED requires an explicit `reverse()` first.
      return { ledger: existing, isNew: false };
    }

    const rateBps = await this.taxConfig.getNumber('tcs_rate_bps', 100);
    const { startUtc, endUtc } = monthRangeUtc(args.filingPeriod);

    // Pull all invoice + credit-note rows for this seller in the
    // period. We aggregate in memory so the intra/inter-state split
    // can use each document's snapshotted state codes.
    const docs = await this.prisma.taxDocument.findMany({
      where: {
        sellerId: args.sellerId,
        generatedAt: { gte: startUtc, lt: endUtc },
        documentType: {
          in: [
            'TAX_INVOICE',
            'INVOICE_CUM_BILL_OF_SUPPLY',
            'CREDIT_NOTE',
          ],
        },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      select: {
        documentType: true,
        taxableAmountInPaise: true,
        sellerStateCode: true,
        placeOfSupplyStateCode: true,
        supplierGstin: true,
      },
    });

    let grossTaxable = 0n;
    let creditNoteReversal = 0n;
    let intraTaxable = 0n;
    let interTaxable = 0n;
    let supplierGstin: string | null = null;
    let supplierStateCode: string | null = null;
    for (const d of docs) {
      // Snapshot the supplier identity from the first invoice we see.
      if (!supplierGstin) supplierGstin = d.supplierGstin;
      if (!supplierStateCode) supplierStateCode = d.sellerStateCode;
      const intraState = isIntraState(d);
      if (d.documentType === 'CREDIT_NOTE') {
        creditNoteReversal += d.taxableAmountInPaise;
        if (intraState) intraTaxable -= d.taxableAmountInPaise;
        else interTaxable -= d.taxableAmountInPaise;
      } else {
        grossTaxable += d.taxableAmountInPaise;
        if (intraState) intraTaxable += d.taxableAmountInPaise;
        else interTaxable += d.taxableAmountInPaise;
      }
    }

    // Apply prior-period carry-forward (negative net supply from the
    // immediately-preceding period). We treat it as an additional
    // "credit-note reversal" so the clamp helper handles negative
    // cases uniformly.
    const priorCarry = await this.priorCarryForward(
      args.sellerId,
      args.filingPeriod,
    );

    const { netTaxableInPaise, carryForwardInPaise } =
      clampNetSupplyWithCarryForward({
        grossTaxableInPaise: grossTaxable,
        creditNoteReversalInPaise: creditNoteReversal,
        priorCarryForwardInPaise: priorCarry,
      });

    // Distribute carry-forward proportionally between intra/inter so
    // the TCS computation reflects the post-clamp split.
    const {
      intra: postClampIntra,
      inter: postClampInter,
    } = distributeClampedSplit({
      rawIntra: intraTaxable,
      rawInter: interTaxable,
      netTaxable: netTaxableInPaise,
    });

    const tcs = computeTcs({
      intraStateTaxableInPaise: postClampIntra,
      interStateTaxableInPaise: postClampInter,
      rateBps,
    });

    const created = await this.prisma.gstTcsSettlementLedger.create({
      data: {
        sellerId: args.sellerId,
        filingPeriod: args.filingPeriod,
        supplierGstin,
        supplierStateCode,
        grossTaxableSupplyInPaise: grossTaxable,
        creditNoteReversalInPaise: creditNoteReversal,
        netTaxableSupplyInPaise: netTaxableInPaise,
        intraStateTaxableInPaise: postClampIntra,
        interStateTaxableInPaise: postClampInter,
        tcsRateBps: tcs.rateBps,
        cgstTcsInPaise: tcs.cgstTcsInPaise,
        sgstTcsInPaise: tcs.sgstTcsInPaise,
        igstTcsInPaise: tcs.igstTcsInPaise,
        totalTcsInPaise: tcs.totalTcsInPaise,
        adjustmentCarriedForwardInPaise: carryForwardInPaise,
        status: 'COMPUTED',
        computedBy: args.computedBy,
        computedReason:
          args.computedReason ??
          `Auto-compute for filing period ${args.filingPeriod}`,
      },
    });
    this.logger.log(
      `TCS computed: seller=${args.sellerId} period=${args.filingPeriod} ` +
        `net=${netTaxableInPaise} cgst=${tcs.cgstTcsInPaise} sgst=${tcs.sgstTcsInPaise} ` +
        `igst=${tcs.igstTcsInPaise} cf=${carryForwardInPaise}`,
    );
    return { ledger: created, isNew: true };
  }

  /** Settlement-run hook: mark TCS as collected from seller's payout. */
  async markCollected(args: {
    ledgerId: string;
    settlementId: string;
  }): Promise<GstTcsSettlementLedger> {
    const ledger = await this.prisma.gstTcsSettlementLedger.findUnique({
      where: { id: args.ledgerId },
    });
    if (!ledger) throw new TcsLedgerNotFoundError(args.ledgerId);
    if (ledger.status === 'COLLECTED') return ledger; // idempotent
    if (ledger.status !== 'COMPUTED') {
      throw new TcsInvalidTransitionError(
        args.ledgerId,
        ledger.status,
        'COLLECTED',
      );
    }
    return this.prisma.gstTcsSettlementLedger.update({
      where: { id: args.ledgerId },
      data: {
        status: 'COLLECTED',
        collectedAt: new Date(),
        settlementId: args.settlementId,
      },
    });
  }

  /** Bulk mark FILED after GSTR-8 upload. */
  async markFiled(args: {
    ledgerIds: string[];
    filedBy: string;
  }): Promise<number> {
    if (args.ledgerIds.length === 0) return 0;
    const now = new Date();
    // updateMany is one round-trip + idempotent: only COLLECTED rows
    // flip; FILED/PAID_TO_GOVT rows are skipped without erroring.
    const result = await this.prisma.gstTcsSettlementLedger.updateMany({
      where: {
        id: { in: args.ledgerIds },
        status: 'COLLECTED',
      },
      data: {
        status: 'FILED',
        filedAt: now,
        filedBy: args.filedBy,
      },
    });
    this.logger.log(
      `GSTR-8 mark-filed: requested=${args.ledgerIds.length} flipped=${result.count}`,
    );
    return result.count;
  }

  /** Bulk mark PAID_TO_GOVT after remittance. */
  async markPaidToGovt(args: {
    ledgerIds: string[];
    paidBy: string;
    paymentReference: string;
  }): Promise<number> {
    if (args.ledgerIds.length === 0) return 0;
    const now = new Date();
    const result = await this.prisma.gstTcsSettlementLedger.updateMany({
      where: {
        id: { in: args.ledgerIds },
        status: 'FILED',
      },
      data: {
        status: 'PAID_TO_GOVT',
        paidToGovtAt: now,
        paidBy: args.paidBy,
        paymentReference: args.paymentReference,
      },
    });
    return result.count;
  }

  /**
   * Reverse a TCS row (correction flow). Marks the source row REVERSED;
   * caller follows up with a fresh `computeForSeller` to produce the
   * corrected row (which will have `correctionOfId` pointing back).
   */
  async reverse(args: {
    ledgerId: string;
    reversedBy: string;
    reason: string;
  }): Promise<GstTcsSettlementLedger> {
    const ledger = await this.prisma.gstTcsSettlementLedger.findUnique({
      where: { id: args.ledgerId },
    });
    if (!ledger) throw new TcsLedgerNotFoundError(args.ledgerId);
    if (ledger.status === 'REVERSED') return ledger; // idempotent

    return this.prisma.gstTcsSettlementLedger.update({
      where: { id: args.ledgerId },
      data: {
        status: 'REVERSED',
        computedReason:
          `${ledger.computedReason ?? ''} | REVERSED by ${args.reversedBy}: ${args.reason}`.slice(
            0,
            500,
          ),
      },
    });
  }

  /**
   * Per-period rollup of all active (non-REVERSED) rows. Drives the
   * GSTR-8 export.
   */
  async listForPeriod(filingPeriod: string): Promise<GstTcsSettlementLedger[]> {
    return this.prisma.gstTcsSettlementLedger.findMany({
      where: {
        filingPeriod,
        status: { not: 'REVERSED' },
      },
      orderBy: [{ supplierGstin: 'asc' }, { sellerId: 'asc' }],
    });
  }

  /**
   * Look up the carry-forward amount from the immediately-preceding
   * filing period for this seller, if any. Used by `computeForSeller`
   * to feed the prior period's negative-net-supply into the current
   * period's compute.
   */
  private async priorCarryForward(
    sellerId: string,
    filingPeriod: string,
  ): Promise<bigint> {
    const prior = previousFilingPeriod(filingPeriod);
    if (!prior) return 0n;
    const row = await this.prisma.gstTcsSettlementLedger.findFirst({
      where: {
        sellerId,
        filingPeriod: prior,
        status: { not: 'REVERSED' },
      },
      select: { adjustmentCarriedForwardInPaise: true },
    });
    return row?.adjustmentCarriedForwardInPaise ?? 0n;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * "2026-04" → "2026-03"; "2026-01" → "2025-12". Returns null when the
 * input doesn't match the YYYY-MM shape.
 */
function previousFilingPeriod(filingPeriod: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(filingPeriod);
  if (!match) return null;
  let y = parseInt(match[1]!, 10);
  let m = parseInt(match[2]!, 10) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${m.toString().padStart(2, '0')}`;
}

/**
 * Compute UTC start (inclusive) and end (exclusive) instants for the
 * given calendar month, treating boundaries as **IST midnights** —
 * so an invoice issued at 00:30 IST on the 1st of the month falls
 * into THIS period, not the previous one.
 */
function monthRangeUtc(filingPeriod: string): {
  startUtc: Date;
  endUtc: Date;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(filingPeriod);
  if (!match) {
    throw new Error(`Invalid filing period: ${filingPeriod} (want YYYY-MM)`);
  }
  const y = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  // IST midnight = UTC midnight minus 5h30m.
  const startUtc = new Date(Date.UTC(y, m - 1, 1) - 5.5 * 60 * 60 * 1000);
  // Next month's IST midnight.
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 0 : m;
  const endUtc = new Date(
    Date.UTC(nextY, nextM, 1) - 5.5 * 60 * 60 * 1000,
  );
  return { startUtc, endUtc };
}

function isIntraState(doc: {
  sellerStateCode: string | null;
  placeOfSupplyStateCode: string | null;
}): boolean {
  if (!doc.sellerStateCode || !doc.placeOfSupplyStateCode) {
    // Conservative default: when we can't tell, treat as inter-state
    // so IGST TCS is computed. The CA's audit then sees the unknowns.
    return false;
  }
  return doc.sellerStateCode === doc.placeOfSupplyStateCode;
}

/**
 * Distribute the post-clamp net taxable supply between intra and
 * inter-state in proportion to the raw split. When both raw legs
 * are zero, defaults the entire net to inter-state.
 */
function distributeClampedSplit(input: {
  rawIntra: bigint;
  rawInter: bigint;
  netTaxable: bigint;
}): { intra: bigint; inter: bigint } {
  if (input.netTaxable === 0n) return { intra: 0n, inter: 0n };

  const rawIntra = input.rawIntra < 0n ? 0n : input.rawIntra;
  const rawInter = input.rawInter < 0n ? 0n : input.rawInter;
  const rawTotal = rawIntra + rawInter;
  if (rawTotal === 0n) {
    return { intra: 0n, inter: input.netTaxable };
  }
  if (rawTotal === input.netTaxable) {
    // No clamping happened — use the raw split verbatim.
    return { intra: rawIntra, inter: rawInter };
  }
  // Scale intra proportionally; inter is the remainder so the two
  // exactly sum to netTaxable.
  const intra = (rawIntra * input.netTaxable) / rawTotal;
  const inter = input.netTaxable - intra;
  return { intra, inter };
}
