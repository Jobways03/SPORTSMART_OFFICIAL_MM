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
import { renderGstTcsCertificateHtml } from '../../domain/gst-tcs-certificate-template';

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

/**
 * Phase 160 (§52 lifecycle audit #9 / #10) — non-fatal compute warning.
 * Persisted on the ledger row's `computeWarningsJson` so the CA sees the
 * spread without the row being blocked.
 */
export interface TcsComputeWarning {
  code: 'MULTI_GSTIN' | 'UNKNOWN_PLACE_OF_SUPPLY';
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Phase 160 (§52 lifecycle audit B4 / #4) — a ledger row that a bulk
 * transition skipped because it wasn't in the expected source state.
 * Returned so the caller can surface the exact stragglers (id +
 * current status) instead of just a "N of M flipped" count.
 */
export interface SkippedLedgerRow {
  ledgerId: string;
  currentStatus: TcsStatus | 'NOT_FOUND';
}

/**
 * Phase 160 — shared bulk-transition result. `flippedIds` are the rows
 * that actually changed state; `skipped` lists every requested id that
 * did NOT, with its current status, so month-end runs over 10k rows
 * have an actionable signal.
 */
export interface BulkTransitionResult {
  flippedCount: number;
  flippedIds: string[];
  skipped: SkippedLedgerRow[];
}

/** markCertificatesIssued result — adds the per-row certificate numbers. */
export interface CertificatesIssuedResult extends BulkTransitionResult {
  certificateNumbers: Record<string, string>;
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
            // Phase 160 (§52 lifecycle audit test #14) — a DEBIT_NOTE is a
            // Section 34 upward correction; it INCREASES the net taxable
            // supply, so it must add to gross exactly like an invoice.
            // It was silently dropped before (only TAX_INVOICE /
            // INVOICE_CUM_BILL_OF_SUPPLY / CREDIT_NOTE were queried),
            // understating TCS whenever a price was corrected upward.
            'DEBIT_NOTE',
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
    // Phase 160 (§52 lifecycle audit #9) — track every distinct supplier
    // GSTIN seen in the period. A seller operating across multiple states
    // can hold more than one GSTIN; snapshotting only the first silently
    // misattributes the period's TCS. We still snapshot the first (so the
    // existing row shape is unchanged) but flag the spread as a warning.
    const distinctGstins = new Set<string>();
    let unknownPosSeen = false;
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
      if (d.supplierGstin) distinctGstins.add(d.supplierGstin);
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
      if (posKey === 'UNK') unknownPosSeen = true;
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

    // Phase 160 (§52 lifecycle audit #9 / #10) — assemble non-fatal
    // compute warnings. The row is still written (so the lifecycle isn't
    // blocked) but the CA sees the spread in the summary + UI.
    const warnings: TcsComputeWarning[] = [];
    if (distinctGstins.size > 1) {
      warnings.push({
        code: 'MULTI_GSTIN',
        message:
          `Seller's invoices this period span ${distinctGstins.size} distinct ` +
          `supplier GSTINs; the row snapshots "${supplierGstin}". Review whether ` +
          `the period should be split per GSTIN before filing GSTR-8.`,
        detail: { gstins: [...distinctGstins].sort() },
      });
    }
    if (unknownPosSeen) {
      warnings.push({
        code: 'UNKNOWN_PLACE_OF_SUPPLY',
        message:
          'One or more documents had no valid place-of-supply state code; ' +
          'those amounts were treated as inter-state (IGST). Reconcile before filing.',
      });
    }

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
        computeWarningsJson: warnings as unknown as Prisma.InputJsonValue,
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
    await this.recordEvent({
      ledgerId: created.id,
      eventType: 'COMPUTED',
      fromStatus: null,
      toStatus: 'COMPUTED',
      actorId: args.computedBy ?? 'system',
      metadata: {
        netTaxableInPaise: netTaxableInPaise.toString(),
        totalTcsInPaise: tcs.totalTcsInPaise.toString(),
        warnings: warnings.map((w) => w.code),
      },
    });
    this.logger.log(
      `TCS computed: seller=${args.sellerId} period=${args.filingPeriod} ` +
        `net=${netTaxableInPaise} cgst=${tcs.cgstTcsInPaise} sgst=${tcs.sgstTcsInPaise} ` +
        `igst=${tcs.igstTcsInPaise} cf=${carryForwardInPaise}` +
        (warnings.length ? ` warnings=${warnings.map((w) => w.code).join(',')}` : ''),
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
    const updated = await this.prisma.gstTcsSettlementLedger.update({
      where: { id: args.ledgerId },
      data: {
        status: 'COLLECTED',
        collectedAt: new Date(),
        settlementId: args.settlementId,
      },
    });
    await this.recordEvent({
      ledgerId: args.ledgerId,
      eventType: 'COLLECTED',
      fromStatus: 'COMPUTED',
      toStatus: 'COLLECTED',
      actorId: 'settlement',
      metadata: { settlementId: args.settlementId },
    });
    return updated;
  }

  /**
   * Phase 160 (§52 lifecycle audit #17) — bulk COMPUTED → COLLECTED for a
   * whole settlement run. The settlement hook previously called
   * `markCollected` one row at a time (a 10k-seller run = 10k round
   * trips). This batches the per-row updates inside a single
   * transaction (each row keeps its own settlementId, so it can't be a
   * single updateMany). Status-guarded per row: a row that isn't
   * COMPUTED is skipped (idempotent + race-safe), not flipped.
   */
  async markCollectedBulk(args: {
    pairs: { ledgerId: string; settlementId: string }[];
  }): Promise<BulkTransitionResult> {
    if (args.pairs.length === 0) {
      return { flippedCount: 0, flippedIds: [], skipped: [] };
    }
    const ids = args.pairs.map((p) => p.ledgerId);
    const rows = await this.prisma.gstTcsSettlementLedger.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });
    const statusById = new Map(rows.map((r) => [r.id, r.status]));
    const now = new Date();
    const flippedIds: string[] = [];
    const skipped: SkippedLedgerRow[] = [];
    // Pairs we'll attempt (status COMPUTED at read time); everything else
    // is skipped up-front with its current status.
    const attempted: { ledgerId: string; settlementId: string }[] = [];
    for (const pair of args.pairs) {
      if (statusById.get(pair.ledgerId) === 'COMPUTED') {
        attempted.push(pair);
      } else {
        skipped.push({
          ledgerId: pair.ledgerId,
          currentStatus: statusById.get(pair.ledgerId) ?? 'NOT_FOUND',
        });
      }
    }
    // updateMany per row inside one transaction. CAS on status='COMPUTED'
    // so a concurrent collect can't double-flip; the transaction returns
    // one {count} per op, and we trust THAT (not the pre-read status) so
    // a row raced to COLLECTED between read and write is reported as
    // skipped, not falsely flipped.
    if (attempted.length > 0) {
      const ops = attempted.map((pair) =>
        this.prisma.gstTcsSettlementLedger.updateMany({
          where: { id: pair.ledgerId, status: 'COMPUTED' },
          data: {
            status: 'COLLECTED',
            collectedAt: now,
            settlementId: pair.settlementId,
          },
        }),
      );
      const results = (await this.prisma.$transaction(ops)) as Array<{
        count: number;
      }>;
      for (let i = 0; i < attempted.length; i++) {
        const pair = attempted[i]!;
        if ((results[i]?.count ?? 0) === 1) {
          flippedIds.push(pair.ledgerId);
          await this.recordEvent({
            ledgerId: pair.ledgerId,
            eventType: 'COLLECTED',
            fromStatus: 'COMPUTED',
            toStatus: 'COLLECTED',
            actorId: 'settlement',
            metadata: { settlementId: pair.settlementId, bulk: true },
          });
        } else {
          // Lost the CAS race — concurrently collected/reversed.
          skipped.push({ ledgerId: pair.ledgerId, currentStatus: 'COLLECTED' });
        }
      }
    }
    return { flippedCount: flippedIds.length, flippedIds, skipped };
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
  }): Promise<BulkTransitionResult> {
    if (args.ledgerIds.length === 0) {
      return { flippedCount: 0, flippedIds: [], skipped: [] };
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
    // Phase 160 (§52 lifecycle audit B4 / #4) — fetch the CURRENT status
    // of every requested row so we can report the exact stragglers
    // (id + currentStatus) instead of a bare "N of M" count.
    const { eligibleIds, skipped } = await this.partitionByStatus(
      args.ledgerIds,
      'COLLECTED',
    );
    if (eligibleIds.length === 0) {
      this.logger.log(
        `GSTR-8 mark-filed: requested=${args.ledgerIds.length} flipped=0 ` +
          `(no COLLECTED rows; ${skipped.length} skipped)`,
      );
      return { flippedCount: 0, flippedIds: [], skipped };
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
    // Phase 160 (review fix) — under a concurrent flip, updateMany's
    // count can be < eligibleIds.length (a row left COLLECTED between the
    // partition SELECT and the CAS). Re-derive the EXACT flipped set from
    // the unique `filedAt=now` stamp so flippedIds + events never overclaim.
    const flippedIds = await this.reconcileFlipped({
      eligibleIds,
      bulkCount: result.count,
      targetStatus: 'FILED',
      stampField: 'filedAt',
      stamp: now,
      skipped,
    });
    for (const ledgerId of flippedIds) {
      await this.recordEvent({
        ledgerId,
        eventType: 'FILED',
        fromStatus: 'COLLECTED',
        toStatus: 'FILED',
        actorId: args.filedBy,
        metadata: { nicArn: arn },
      });
    }
    this.logger.log(
      `GSTR-8 mark-filed: requested=${args.ledgerIds.length} ` +
        `flipped=${flippedIds.length} skipped=${skipped.length} arn=${arn}`,
    );
    return { flippedCount: flippedIds.length, flippedIds, skipped };
  }

  /**
   * Bulk mark PAID_TO_GOVT after remittance.
   *
   * Phase 160 (§52 lifecycle audit #11) — accepts an optional
   * paymentProofFileId (the bank-challan PDF handle) persisted alongside
   * the reference string. (#4) Returns the skipped stragglers.
   */
  async markPaidToGovt(args: {
    ledgerIds: string[];
    paidBy: string;
    paymentReference: string;
    paymentProofFileId?: string | null;
  }): Promise<BulkTransitionResult> {
    if (args.ledgerIds.length === 0) {
      return { flippedCount: 0, flippedIds: [], skipped: [] };
    }
    const { eligibleIds, skipped } = await this.partitionByStatus(
      args.ledgerIds,
      'FILED',
    );
    if (eligibleIds.length === 0) {
      return { flippedCount: 0, flippedIds: [], skipped };
    }
    const now = new Date();
    const result = await this.prisma.gstTcsSettlementLedger.updateMany({
      where: { id: { in: eligibleIds }, status: 'FILED' },
      data: {
        status: 'PAID_TO_GOVT',
        paidToGovtAt: now,
        paidBy: args.paidBy,
        paymentReference: args.paymentReference,
        paymentProofFileId: args.paymentProofFileId ?? null,
      },
    });
    const flippedIds = await this.reconcileFlipped({
      eligibleIds,
      bulkCount: result.count,
      targetStatus: 'PAID_TO_GOVT',
      stampField: 'paidToGovtAt',
      stamp: now,
      skipped,
    });
    for (const ledgerId of flippedIds) {
      await this.recordEvent({
        ledgerId,
        eventType: 'PAID_TO_GOVT',
        fromStatus: 'FILED',
        toStatus: 'PAID_TO_GOVT',
        actorId: args.paidBy,
        metadata: {
          paymentReference: args.paymentReference,
          paymentProofFileId: args.paymentProofFileId ?? null,
        },
      });
    }
    this.logger.log(
      `GSTR-8 mark-paid: requested=${args.ledgerIds.length} ` +
        `flipped=${flippedIds.length} skipped=${skipped.length}`,
    );
    return { flippedCount: flippedIds.length, flippedIds, skipped };
  }

  /**
   * Phase 160 (§52 lifecycle audit B1 / #12) — bulk mark
   * CERTIFICATE_ISSUED after the operator furnishes the §52(5) TCS
   * certificate to each supplier. The terminal lifecycle stage; only
   * PAID_TO_GOVT rows are eligible (you can't furnish a certificate for
   * tax you haven't yet remitted).
   *
   * Each row gets its OWN certificate number (unlike the §194-O bulk
   * method which took a single shared number — wrong for per-supplier
   * certificates). Format: `{prefix}/{YYYY-MM}/{ledgerId8}`. The schema's
   * partial-unique index on certificate_number is the final guard.
   *
   * CAS per row (updateMany where status='PAID_TO_GOVT') so a concurrent
   * call can't double-issue; rows that already moved on are reported in
   * `skipped`.
   */
  async markCertificatesIssued(args: {
    ledgerIds: string[];
    issuedBy: string;
    certificateNumberPrefix?: string;
  }): Promise<CertificatesIssuedResult> {
    if (args.ledgerIds.length === 0) {
      return {
        flippedCount: 0,
        flippedIds: [],
        skipped: [],
        certificateNumbers: {},
      };
    }
    const prefix = (args.certificateNumberPrefix ?? 'TCS')
      .trim()
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 12) || 'TCS';
    const rows = await this.prisma.gstTcsSettlementLedger.findMany({
      where: { id: { in: args.ledgerIds } },
      select: { id: true, status: true, filingPeriod: true, certificateNumber: true },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const now = new Date();
    const flippedIds: string[] = [];
    const skipped: SkippedLedgerRow[] = [];
    const certificateNumbers: Record<string, string> = {};
    for (const ledgerId of args.ledgerIds) {
      const row = rowById.get(ledgerId);
      if (!row || row.status !== 'PAID_TO_GOVT') {
        skipped.push({
          ledgerId,
          currentStatus: row?.status ?? 'NOT_FOUND',
        });
        continue;
      }
      const certificateNumber =
        row.certificateNumber ??
        `${prefix}/${row.filingPeriod}/${ledgerId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      // CAS: only flip if STILL PAID_TO_GOVT at write time.
      const upd = await this.prisma.gstTcsSettlementLedger.updateMany({
        where: { id: ledgerId, status: 'PAID_TO_GOVT' },
        data: {
          status: 'CERTIFICATE_ISSUED',
          certificateNumber,
          certificateIssuedAt: now,
          certificateIssuedBy: args.issuedBy,
        },
      });
      if (upd.count === 1) {
        flippedIds.push(ledgerId);
        certificateNumbers[ledgerId] = certificateNumber;
        await this.recordEvent({
          ledgerId,
          eventType: 'CERTIFICATE_ISSUED',
          fromStatus: 'PAID_TO_GOVT',
          toStatus: 'CERTIFICATE_ISSUED',
          actorId: args.issuedBy,
          metadata: { certificateNumber },
        });
      } else {
        // Lost the race — re-read for an accurate current status.
        const fresh = await this.prisma.gstTcsSettlementLedger.findUnique({
          where: { id: ledgerId },
          select: { status: true },
        });
        skipped.push({
          ledgerId,
          currentStatus: fresh?.status ?? 'NOT_FOUND',
        });
      }
    }
    this.logger.log(
      `TCS mark-certificates-issued: requested=${args.ledgerIds.length} ` +
        `flipped=${flippedIds.length} skipped=${skipped.length}`,
    );
    return {
      flippedCount: flippedIds.length,
      flippedIds,
      skipped,
      certificateNumbers,
    };
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
    reason: string;
  }> {
    const ledger = await this.prisma.gstTcsSettlementLedger.findUnique({
      where: { id: args.ledgerId },
    });
    if (!ledger) throw new TcsLedgerNotFoundError(args.ledgerId);
    if (ledger.status === 'REVERSED') {
      // Idempotent no-op: the row is already reversed, so we DON'T
      // overwrite the original reversal reason with a new one — we
      // return the reason of record (the first reversal). A caller that
      // re-reverses with a different reason gets `wasAlreadyReversed:true`
      // and the persisted reason, signalling its reason was not applied.
      return {
        ledger,
        previousStatus: 'REVERSED',
        wasAlreadyReversed: true,
        reason: ledger.reversalReason ?? args.reason,
      };
    }

    // Phase 160 (§52 lifecycle audit #8) — the reason no longer overloads
    // (and truncates at 500 chars) computedReason. It lands on dedicated
    // structured columns + the append-only event log (full, untruncated).
    // computedReason stays intact so the original compute provenance is
    // never clobbered by a reversal note.
    const updated = await this.prisma.gstTcsSettlementLedger.update({
      where: { id: args.ledgerId },
      data: {
        status: 'REVERSED',
        reversedAt: new Date(),
        reversedBy: args.reversedBy,
        reversalReason: args.reason,
      },
    });
    await this.recordEvent({
      ledgerId: args.ledgerId,
      eventType: 'REVERSED',
      fromStatus: ledger.status,
      toStatus: 'REVERSED',
      actorId: args.reversedBy,
      reason: args.reason,
      metadata: { previousStatus: ledger.status },
    });
    return {
      ledger: updated,
      previousStatus: ledger.status,
      wasAlreadyReversed: false,
      reason: args.reason,
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
      // Phase 160 (§52 lifecycle audit #13) — carry-forward total surfaced.
      adjustmentCarriedForwardInPaise: bigint;
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
          adjustmentCarriedForwardInPaise: true,
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
        adjustmentCarriedForwardInPaise:
          agg._sum.adjustmentCarriedForwardInPaise ?? 0n,
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
   * Phase 160 (§52 lifecycle audit #10 + #13) — period-level warnings for
   * the GSTR-8 summary. Currently:
   *   - RATE_VARIANCE: rows in the period were computed at more than one
   *     tcsRateBps (a mid-period CBIC rate change). The per-row snapshot
   *     preserves history, but the mix is otherwise invisible.
   *   - CARRY_FORWARD: count + total of rows carrying a non-zero
   *     adjustment forward (operationally hidden otherwise).
   */
  async getPeriodComputeWarnings(filingPeriod: string): Promise<{
    rateVariance: { distinctRatesBps: number[] } | null;
    carryForward: { rowCount: number; totalInPaise: bigint } | null;
  }> {
    const where = {
      filingPeriod,
      status: { not: 'REVERSED' as const },
    };
    const [rateGroups, cf] = await Promise.all([
      this.prisma.gstTcsSettlementLedger.groupBy({
        by: ['tcsRateBps'],
        where,
      }),
      this.prisma.gstTcsSettlementLedger.aggregate({
        where: { ...where, adjustmentCarriedForwardInPaise: { gt: 0 } },
        _count: { _all: true },
        _sum: { adjustmentCarriedForwardInPaise: true },
      }),
    ]);
    const distinctRatesBps = rateGroups
      .map((g) => g.tcsRateBps)
      .sort((a, b) => a - b);
    const cfCount = cf._count._all;
    return {
      rateVariance:
        distinctRatesBps.length > 1 ? { distinctRatesBps } : null,
      carryForward:
        cfCount > 0
          ? {
              rowCount: cfCount,
              totalInPaise: cf._sum.adjustmentCarriedForwardInPaise ?? 0n,
            }
          : null,
    };
  }

  /**
   * Phase 160 (§52 lifecycle audit B1) — per-status row counts for a
   * period (drives the admin certificate-workflow counters: how many
   * rows are PAID_TO_GOVT awaiting a certificate vs already issued).
   * Excludes REVERSED. Returns a complete record (zero-filled).
   */
  async getPeriodStatusCounts(
    filingPeriod: string,
  ): Promise<Record<TcsStatus, number>> {
    // Excludes REVERSED so the counts reconcile with `sellerCount` (which
    // listForPeriodPaginated computes over non-REVERSED rows) — otherwise
    // the per-status counts wouldn't sum to the headline row count.
    const groups = await this.prisma.gstTcsSettlementLedger.groupBy({
      by: ['status'],
      where: { filingPeriod, status: { not: 'REVERSED' } },
      _count: { _all: true },
    });
    const counts: Record<TcsStatus, number> = {
      COMPUTED: 0,
      COLLECTED: 0,
      FILED: 0,
      PAID_TO_GOVT: 0,
      CERTIFICATE_ISSUED: 0,
      REVERSED: 0,
    };
    for (const g of groups) counts[g.status] = g._count._all;
    return counts;
  }

  /**
   * Phase 160 (§52 lifecycle audit B2 / #2) — seller-scoped list of the
   * seller's OWN TCS rows. Used by the seller-facing controller. Caller
   * MUST pass the authenticated seller's id; the where-clause scopes to
   * it so no cross-seller leakage is possible. Optional filingPeriod
   * filter; otherwise returns the most recent rows first.
   */
  async listForSeller(args: {
    sellerId: string;
    filingPeriod?: string;
    limit?: number;
  }): Promise<GstTcsSettlementLedger[]> {
    const take = Math.max(1, Math.min(120, args.limit ?? 60));
    return this.prisma.gstTcsSettlementLedger.findMany({
      where: {
        sellerId: args.sellerId,
        status: { not: 'REVERSED' },
        ...(args.filingPeriod ? { filingPeriod: args.filingPeriod } : {}),
      },
      orderBy: [{ filingPeriod: 'desc' }, { computedAt: 'desc' }],
      take,
    });
  }

  /**
   * Phase 160 — fetch a single ledger row's id + sellerId for an
   * ownership check (seller certificate download). Returns null when the
   * row doesn't exist. Deliberately minimal so the seller controller can
   * authorise WITHOUT pulling the whole row first.
   */
  async getLedgerOwner(
    ledgerId: string,
  ): Promise<{ id: string; sellerId: string | null; status: TcsStatus } | null> {
    return this.prisma.gstTcsSettlementLedger.findUnique({
      where: { id: ledgerId },
      select: { id: true, sellerId: true, status: true },
    });
  }

  /**
   * Phase 160 (§52 lifecycle audit #6) — append-only status history for
   * one ledger row, oldest first. Drives the admin + seller timelines.
   */
  async getLedgerEvents(ledgerId: string) {
    return this.prisma.gstTcsLedgerEvent.findMany({
      where: { ledgerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Phase 160 (§52 lifecycle audit B1 / #2) — render the §52(5) TCS
   * certificate HTML for one ledger row. Resolves the operator identity
   * from the default PlatformGstProfile (same proxy the §194-O Form 16A
   * render uses). Returns null when the row doesn't exist (controller →
   * 404). Idempotent + safe to render repeatedly; for non-issued rows it
   * renders a PREVIEW banner so admins can review before stamping.
   */
  async renderCertificateHtml(ledgerId: string): Promise<string | null> {
    const row = await this.prisma.gstTcsSettlementLedger.findUnique({
      where: { id: ledgerId },
      include: {
        seller: {
          select: {
            sellerShopName: true,
            sellerName: true,
            legalBusinessName: true,
          },
        },
      },
    });
    if (!row) return null;

    const platform = await this.prisma.platformGstProfile.findFirst({
      where: { isDefault: true, isActive: true },
      select: {
        legalBusinessName: true,
        gstin: true,
        registeredAddressJson: true,
      },
    });
    if (!platform) {
      // Phase 160 (review fix) — don't silently stamp a wrong operator
      // identity onto a statutory certificate. The default profile is a
      // hard precondition for GSTR-8 export (resolveOperatorGstin →
      // requireDefault); a missing one here means misconfiguration.
      this.logger.warn(
        `renderCertificateHtml: no default+active PlatformGstProfile found — ` +
          `certificate ${ledgerId} will render with placeholder operator identity. ` +
          `Configure the platform GST profile before furnishing certificates.`,
      );
    }

    const flattenAddress = (j: unknown): string => {
      if (!j || typeof j !== 'object') return '';
      const a = j as Record<string, unknown>;
      return [a.line1, a.line2, a.city, a.state, a.pincode, a.country]
        .filter((v) => typeof v === 'string' && v)
        .join(', ');
    };

    const [yearStr, monthStr] = row.filingPeriod.split('-');
    const fyStartYear =
      parseInt(monthStr ?? '1', 10) >= 4
        ? parseInt(yearStr ?? '0', 10)
        : parseInt(yearStr ?? '0', 10) - 1;
    const financialYear = `${fyStartYear}-${(fyStartYear + 1)
      .toString()
      .slice(-2)}`;

    const supplierName =
      row.seller?.legalBusinessName ??
      row.seller?.sellerShopName ??
      row.seller?.sellerName ??
      'Unknown supplier';

    return renderGstTcsCertificateHtml({
      operatorName: platform?.legalBusinessName ?? 'Sportsmart',
      operatorGstin: platform?.gstin ?? null,
      operatorAddress: flattenAddress(platform?.registeredAddressJson),
      supplierName,
      supplierGstin: row.supplierGstin,
      filingPeriod: row.filingPeriod,
      financialYear,
      grossTaxableInPaise: row.grossTaxableSupplyInPaise,
      netTaxableInPaise: row.netTaxableSupplyInPaise,
      tcsRateBps: row.tcsRateBps,
      cgstTcsInPaise: row.cgstTcsInPaise,
      sgstTcsInPaise: row.sgstTcsInPaise,
      igstTcsInPaise: row.igstTcsInPaise,
      totalTcsInPaise: row.totalTcsInPaise,
      certificateNumber:
        row.certificateNumber ??
        `(draft) TCS/${row.filingPeriod}/${row.id
          .replace(/-/g, '')
          .slice(0, 8)
          .toUpperCase()}`,
      nicArn: row.nicArn,
      paymentReference: row.paymentReference,
      dateOfIssue: row.certificateIssuedAt ?? new Date(),
      isIssued: row.status === 'CERTIFICATE_ISSUED',
    });
  }

  /**
   * Phase 160 — partition a requested id list into the rows currently in
   * the required source status (`eligibleIds`) and everything else
   * (`skipped`, with the exact current status, or NOT_FOUND). Shared by
   * markFiled / markPaidToGovt so both report the same actionable shape
   * (§52 lifecycle audit B4 / #4).
   */
  /**
   * Phase 160 (review fix) — after a bulk CAS updateMany, derive the
   * EXACT set of rows this call flipped. Fast path: when the bulk count
   * equals the eligible count (no concurrent interference — the common
   * case) the eligible list IS the flipped list. Slow path (count
   * mismatch): re-query by the per-call timestamp stamp (unique to this
   * call) to identify precisely which rows flipped; the rest are pushed
   * to `skipped` as RACED so events/audit never overclaim.
   */
  private async reconcileFlipped(args: {
    eligibleIds: string[];
    bulkCount: number;
    targetStatus: TcsStatus;
    stampField: 'filedAt' | 'paidToGovtAt';
    stamp: Date;
    skipped: SkippedLedgerRow[];
  }): Promise<string[]> {
    if (args.bulkCount === args.eligibleIds.length) {
      return args.eligibleIds;
    }
    const flipped = await this.prisma.gstTcsSettlementLedger.findMany({
      where: {
        id: { in: args.eligibleIds },
        status: args.targetStatus,
        [args.stampField]: args.stamp,
      },
      select: { id: true },
    });
    const flippedSet = new Set(flipped.map((r) => r.id));
    for (const id of args.eligibleIds) {
      if (!flippedSet.has(id)) {
        args.skipped.push({ ledgerId: id, currentStatus: 'NOT_FOUND' });
      }
    }
    return args.eligibleIds.filter((id) => flippedSet.has(id));
  }

  private async partitionByStatus(
    ledgerIds: string[],
    requiredStatus: TcsStatus,
  ): Promise<{ eligibleIds: string[]; skipped: SkippedLedgerRow[] }> {
    const rows = await this.prisma.gstTcsSettlementLedger.findMany({
      where: { id: { in: ledgerIds } },
      select: { id: true, status: true },
    });
    const statusById = new Map(rows.map((r) => [r.id, r.status]));
    const eligibleIds: string[] = [];
    const skipped: SkippedLedgerRow[] = [];
    for (const id of ledgerIds) {
      const status = statusById.get(id);
      if (status === requiredStatus) eligibleIds.push(id);
      else skipped.push({ ledgerId: id, currentStatus: status ?? 'NOT_FOUND' });
    }
    return { eligibleIds, skipped };
  }

  /**
   * Phase 160 (§52 lifecycle audit #6 / #8) — append one immutable row to
   * the lifecycle event log. Best-effort: an event-write failure logs but
   * never fails the upstream status change (same resilience contract the
   * controller uses for audit_logs). The cross-module audit_logs entry is
   * still written by the controller; this is the in-domain, query-by-
   * ledger history.
   */
  private async recordEvent(args: {
    ledgerId: string;
    eventType: 'COMPUTED' | 'COLLECTED' | 'FILED' | 'PAID_TO_GOVT' | 'CERTIFICATE_ISSUED' | 'REVERSED';
    fromStatus: TcsStatus | null;
    toStatus: TcsStatus;
    actorId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.gstTcsLedgerEvent.create({
        data: {
          ledgerId: args.ledgerId,
          eventType: args.eventType,
          fromStatus: args.fromStatus,
          toStatus: args.toStatus,
          actorId: args.actorId ?? null,
          reason: args.reason ?? null,
          metadataJson: (args.metadata ?? {}) as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `TCS lifecycle event write failed for ledger ${args.ledgerId} ` +
          `(${args.eventType}; non-fatal): ${(err as Error).message}`,
      );
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
