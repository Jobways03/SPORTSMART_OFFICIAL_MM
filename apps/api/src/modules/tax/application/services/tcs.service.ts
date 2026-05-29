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
import { PlaceOfSupplyService } from './place-of-supply.service';
import { TaxConfigService } from './tax-config.service';
import {
  clampNetSupplyWithCarryForward,
  computeTcs,
  filingPeriodOf,
} from '../../domain/tcs-calculator';

/**
 * Phase 159z (GSTR-8 audit #16) — centralised IST offset matching the
 * GSTR-1 and GSTR-3B exporters. India Standard Time is UTC+5:30; an
 * invoice generated at 00:30 IST on the 1st of the month falls into
 * THIS period, not the previous one.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Phase 159z (GSTR-8 audit #4) — per-place-of-supply breakdown stored
 * on the ledger so the CBIC §3 CSV can decompose a (seller, period)
 * roll-up into one row per (supplier, place-of-supply).
 *
 * `pos` is the 2-digit GST state code (or 'UNK' when the source
 * invoice didn't snapshot a place-of-supply — extremely rare).
 * `posName` is the canonical state name resolved at compute time so
 * the exporter doesn't need to re-touch india_states.
 *
 * Money fields are BigInt-paise serialised as strings so the column
 * stays JSON-safe (`JSON.stringify(bigint)` throws). Three money
 * legs are kept per PoS:
 *   - grossInPaise:               sum of invoice taxable amounts
 *   - creditNoteReversalInPaise:  sum of credit-note taxable amounts
 *   - netTaxableInPaise:          gross − creditNoteReversal (≥0)
 * The TCS legs (cgst/sgst/igst/total) are computed at the breakdown
 * level from the post-clamp net so the per-PoS row in the CSV /
 * NIC JSON adds up to the ledger's rolled-up totals.
 */
export interface PlaceOfSupplyBreakdownEntry {
  pos: string;
  posName: string;
  grossInPaise: string;
  creditNoteReversalInPaise: string;
  netTaxableInPaise: string;
  cgstTcsInPaise: string;
  sgstTcsInPaise: string;
  igstTcsInPaise: string;
  totalTcsInPaise: string;
}

/**
 * Phase 159z (GSTR-8 audit B1) — listForPeriod return type. The seller
 * relation is included so the exporter can populate the CBIC GSTR-8
 * "Trade Name of the Supplier" column (the schema has the relation;
 * the prior implementation never selected it).
 */
export type GstTcsSettlementLedgerWithSeller = GstTcsSettlementLedger & {
  seller: { id: string; sellerName: string; sellerShopName: string } | null;
};

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
    private readonly placeOfSupply: PlaceOfSupplyService,
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
    // Phase 159z (audit #4) — also keep documentNumber so the
    // place-of-supply breakdown can attribute per-document totals
    // when the CA reconciles a discrepancy.
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
    // Phase 159z (audit #4) — per-place-of-supply accumulator. Keyed by
    // PoS state code; tracks gross / CN reversal separately so the CBIC
    // GSTR-8 row can be emitted with both columns populated. The
    // intra/inter split is also kept per-PoS so the TCS computation in
    // the breakdown can use the same computeTcs helper as the rolled
    // totals (consistent rate application + clamp semantics).
    const posAccumulator = new Map<
      string,
      { gross: bigint; cnReversal: bigint; intra: bigint; inter: bigint }
    >();
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
      // Per-place-of-supply tally. CBIC GSTR-8 wants the supplier's
      // place-of-supply (the buyer state); the source invoice already
      // snapshotted it. When unresolved, key the bucket on 'UNK' so
      // the breakdown doesn't silently drop the document.
      const posKey =
        d.placeOfSupplyStateCode && /^\d{2}$/.test(d.placeOfSupplyStateCode)
          ? d.placeOfSupplyStateCode
          : 'UNK';
      const bucket = posAccumulator.get(posKey) ?? {
        gross: 0n,
        cnReversal: 0n,
        intra: 0n,
        inter: 0n,
      };
      if (d.documentType === 'CREDIT_NOTE') {
        bucket.cnReversal += d.taxableAmountInPaise;
        if (intraState) bucket.intra -= d.taxableAmountInPaise;
        else bucket.inter -= d.taxableAmountInPaise;
      } else {
        bucket.gross += d.taxableAmountInPaise;
        if (intraState) bucket.intra += d.taxableAmountInPaise;
        else bucket.inter += d.taxableAmountInPaise;
      }
      posAccumulator.set(posKey, bucket);
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

    // Phase 159z (audit #4) — finalise per-place-of-supply breakdown.
    // Each bucket is taxed via the same computeTcs helper that the
    // rolled totals used, so the per-PoS rates are consistent. Once a
    // ledger row carries CSV-emit time data, the GSTR-8 exporter
    // iterates `placeOfSupplyBreakdownJson` to emit one CSV row per
    // (supplier, PoS) — the CBIC-format row structure.
    const codeToName = await this.placeOfSupply.getStateCodeToNameMap();
    const breakdown: PlaceOfSupplyBreakdownEntry[] = [];
    for (const [pos, b] of posAccumulator) {
      const netForPos = b.gross - b.cnReversal;
      // Skip buckets that fully washed out (net ≤ 0) — the CN reversal
      // is still captured in the rolled-up creditNoteReversal column
      // and the carry-forward path; emitting a zero-net row would
      // confuse the CBIC export consumer.
      if (netForPos <= 0n) continue;
      const split = computeTcs({
        intraStateTaxableInPaise: b.intra > 0n ? b.intra : 0n,
        interStateTaxableInPaise: b.inter > 0n ? b.inter : 0n,
        rateBps,
      });
      breakdown.push({
        pos,
        posName: codeToName.get(pos) ?? (pos === 'UNK' ? 'Unknown' : pos),
        grossInPaise: b.gross.toString(),
        creditNoteReversalInPaise: b.cnReversal.toString(),
        netTaxableInPaise: netForPos.toString(),
        cgstTcsInPaise: split.cgstTcsInPaise.toString(),
        sgstTcsInPaise: split.sgstTcsInPaise.toString(),
        igstTcsInPaise: split.igstTcsInPaise.toString(),
        totalTcsInPaise: split.totalTcsInPaise.toString(),
      });
    }
    // Stable ordering for deterministic CSV output.
    breakdown.sort((a, b) => a.pos.localeCompare(b.pos));

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
        placeOfSupplyBreakdownJson:
          breakdown as unknown as Prisma.InputJsonValue,
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

  /**
   * Bulk mark FILED after GSTR-8 upload.
   *
   * Phase 159z (audit #6) — requires the GSTN ARN (Acknowledgement
   * Reference Number) returned by the NIC portal after a successful
   * GSTR-8 submission. Without it, FILED is unprovable; with it, every
   * filed row has a NIC-side handle that the CA can audit.
   *
   * Returns the count of rows actually flipped AND the IDs (so the
   * controller can write per-row audit logs).
   */
  async markFiled(args: {
    ledgerIds: string[];
    filedBy: string;
    nicArn: string;
  }): Promise<{ flippedCount: number; flippedIds: string[] }> {
    if (args.ledgerIds.length === 0) {
      return { flippedCount: 0, flippedIds: [] };
    }
    if (!args.nicArn || !args.nicArn.trim()) {
      // Defence in depth: the DTO also validates this, but the service
      // refuses to silently file rows without ARN regardless of caller.
      throw new Error(
        'markFiled requires a non-empty nicArn — supply the GSTN ' +
          'Acknowledgement Reference Number from the NIC portal.',
      );
    }
    const now = new Date();
    const arn = args.nicArn.trim();
    // Snapshot which rows are about to flip so we can return their IDs
    // for downstream audit-log writes. The status filter is replicated
    // in the updateMany so we still get the same atomic semantics.
    const eligible = await this.prisma.gstTcsSettlementLedger.findMany({
      where: { id: { in: args.ledgerIds }, status: 'COLLECTED' },
      select: { id: true },
    });
    const eligibleIds = eligible.map((e) => e.id);
    if (eligibleIds.length === 0) {
      this.logger.log(
        `GSTR-8 mark-filed: requested=${args.ledgerIds.length} flipped=0 (no COLLECTED rows)`,
      );
      return { flippedCount: 0, flippedIds: [] };
    }
    const result = await this.prisma.gstTcsSettlementLedger.updateMany({
      where: { id: { in: eligibleIds }, status: 'COLLECTED' },
      data: {
        status: 'FILED',
        filedAt: now,
        filedBy: args.filedBy,
        nicArn: arn,
      },
    });
    this.logger.log(
      `GSTR-8 mark-filed: requested=${args.ledgerIds.length} ` +
        `flipped=${result.count} arn=${arn}`,
    );
    return { flippedCount: result.count, flippedIds: eligibleIds };
  }

  /** Bulk mark PAID_TO_GOVT after remittance. */
  async markPaidToGovt(args: {
    ledgerIds: string[];
    paidBy: string;
    paymentReference: string;
  }): Promise<{ flippedCount: number; flippedIds: string[] }> {
    if (args.ledgerIds.length === 0) {
      return { flippedCount: 0, flippedIds: [] };
    }
    const eligible = await this.prisma.gstTcsSettlementLedger.findMany({
      where: { id: { in: args.ledgerIds }, status: 'FILED' },
      select: { id: true },
    });
    const eligibleIds = eligible.map((e) => e.id);
    if (eligibleIds.length === 0) {
      return { flippedCount: 0, flippedIds: [] };
    }
    const now = new Date();
    const result = await this.prisma.gstTcsSettlementLedger.updateMany({
      where: { id: { in: eligibleIds }, status: 'FILED' },
      data: {
        status: 'PAID_TO_GOVT',
        paidToGovtAt: now,
        paidBy: args.paidBy,
        paymentReference: args.paymentReference,
      },
    });
    return { flippedCount: result.count, flippedIds: eligibleIds };
  }

  /**
   * Reverse a TCS row (correction flow). Marks the source row REVERSED;
   * caller follows up with a fresh `computeForSeller` to produce the
   * corrected row (which will have `correctionOfId` pointing back).
   *
   * Phase 159z (audit #10 + lifecycle audits) — returns the previous
   * status so the controller can write a complete audit_logs row with
   * oldValue/newValue (vs. a bare "REVERSED" no-context entry).
   */
  async reverse(args: {
    ledgerId: string;
    reversedBy: string;
    reason: string;
  }): Promise<{
    ledger: GstTcsSettlementLedger;
    previousStatus: TcsStatus;
    wasAlreadyReversed: boolean;
  }> {
    const ledger = await this.prisma.gstTcsSettlementLedger.findUnique({
      where: { id: args.ledgerId },
    });
    if (!ledger) throw new TcsLedgerNotFoundError(args.ledgerId);
    if (ledger.status === 'REVERSED') {
      return {
        ledger,
        previousStatus: 'REVERSED',
        wasAlreadyReversed: true,
      };
    }

    const updated = await this.prisma.gstTcsSettlementLedger.update({
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
    return {
      ledger: updated,
      previousStatus: ledger.status,
      wasAlreadyReversed: false,
    };
  }

  /**
   * Per-period rollup of all active (non-REVERSED) rows. Drives the
   * GSTR-8 export.
   *
   * Phase 159z (audit B1) — includes the seller relation so the GSTR-8
   * exporter can populate the CBIC "Trade Name of the Supplier" column.
   * The relation is small (one row per ledger row); for very-large
   * periods callers should prefer `listForPeriodPaginated`.
   */
  async listForPeriod(
    filingPeriod: string,
  ): Promise<GstTcsSettlementLedgerWithSeller[]> {
    return this.prisma.gstTcsSettlementLedger.findMany({
      where: {
        filingPeriod,
        status: { not: 'REVERSED' },
      },
      include: {
        seller: { select: { id: true, sellerName: true, sellerShopName: true } },
      },
      orderBy: [{ supplierGstin: 'asc' }, { sellerId: 'asc' }],
    });
  }

  /**
   * Phase 159z (audit #14) — paginated variant for the GSTR-8 admin
   * summary endpoint. A high-seller-count period would otherwise ship
   * a multi-megabyte rows array on every reload; the UI now fetches
   * by page. Returns:
   *   - page rows (with seller include) for table rendering
   *   - the total active count (for pagination footer)
   *   - aggregate rollups across ALL pages so the totals are honest
   *     even when the table only shows one page at a time.
   */
  async listForPeriodPaginated(args: {
    filingPeriod: string;
    page: number;
    pageSize: number;
  }): Promise<{
    rows: GstTcsSettlementLedgerWithSeller[];
    totalRows: number;
    totalPages: number;
    page: number;
    pageSize: number;
    totals: {
      grossTaxableSupplyInPaise: bigint;
      creditNoteReversalInPaise: bigint;
      netTaxableSupplyInPaise: bigint;
      cgstTcsInPaise: bigint;
      sgstTcsInPaise: bigint;
      igstTcsInPaise: bigint;
      totalTcsInPaise: bigint;
    };
  }> {
    const page = Math.max(1, Math.floor(args.page));
    const pageSize = Math.max(1, Math.min(500, Math.floor(args.pageSize)));
    const where = { filingPeriod: args.filingPeriod, status: { not: 'REVERSED' as const } };
    const [rows, totalRows, agg] = await Promise.all([
      this.prisma.gstTcsSettlementLedger.findMany({
        where,
        include: {
          seller: {
            select: { id: true, sellerName: true, sellerShopName: true },
          },
        },
        orderBy: [{ supplierGstin: 'asc' }, { sellerId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.gstTcsSettlementLedger.count({ where }),
      this.prisma.gstTcsSettlementLedger.aggregate({
        where,
        _sum: {
          grossTaxableSupplyInPaise: true,
          creditNoteReversalInPaise: true,
          netTaxableSupplyInPaise: true,
          cgstTcsInPaise: true,
          sgstTcsInPaise: true,
          igstTcsInPaise: true,
          totalTcsInPaise: true,
        },
      }),
    ]);
    return {
      rows,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
      page,
      pageSize,
      totals: {
        grossTaxableSupplyInPaise: agg._sum.grossTaxableSupplyInPaise ?? 0n,
        creditNoteReversalInPaise: agg._sum.creditNoteReversalInPaise ?? 0n,
        netTaxableSupplyInPaise: agg._sum.netTaxableSupplyInPaise ?? 0n,
        cgstTcsInPaise: agg._sum.cgstTcsInPaise ?? 0n,
        sgstTcsInPaise: agg._sum.sgstTcsInPaise ?? 0n,
        igstTcsInPaise: agg._sum.igstTcsInPaise ?? 0n,
        totalTcsInPaise: agg._sum.totalTcsInPaise ?? 0n,
      },
    };
  }

  /**
   * Phase 159z (audit #8 — streaming support). Iterates the active
   * ledger rows for the period in fixed-size batches so the GSTR-8
   * CSV exporter can stream row-by-row instead of buffering every
   * row in memory. Yields rows in supplier-GSTIN-then-sellerId order
   * (same as listForPeriod). Each row carries the seller include so
   * the CSV trade-name column can be populated without a second query.
   */
  async *streamForPeriod(
    filingPeriod: string,
    batchSize = 200,
  ): AsyncGenerator<GstTcsSettlementLedgerWithSeller, void, void> {
    const take = Math.max(50, Math.min(1000, Math.floor(batchSize)));
    let cursorId: string | undefined;
    while (true) {
      const batch = await this.prisma.gstTcsSettlementLedger.findMany({
        where: { filingPeriod, status: { not: 'REVERSED' } },
        include: {
          seller: {
            select: { id: true, sellerName: true, sellerShopName: true },
          },
        },
        orderBy: [{ supplierGstin: 'asc' }, { sellerId: 'asc' }, { id: 'asc' }],
        take,
        skip: cursorId ? 1 : 0,
        ...(cursorId ? { cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;
      for (const row of batch) yield row;
      if (batch.length < take) break;
      cursorId = batch[batch.length - 1]!.id;
    }
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
 *
 * Phase 159z (audit #16) — uses the shared IST_OFFSET_MS constant
 * (same one used by gstr1-report and gstr3b-report) so a future
 * timezone fix lands in exactly one place.
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
  const startUtc = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
  // Next month's IST midnight.
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 0 : m;
  const endUtc = new Date(
    Date.UTC(nextY, nextM, 1) - IST_OFFSET_MS,
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
