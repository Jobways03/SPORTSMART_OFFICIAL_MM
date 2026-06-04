// Phase 28+ — Marketplace commission GSTR-1 export.
//
// The marketplace's commission to a seller is a B2B service supply
// (SAC 9985) the platform must declare on ITS OWN GSTR-1 outward
// supplies — separate from the per-seller GSTR-1 the platform also
// generates on behalf of sellers for their PRODUCT sales.
//
// Phase 159aa — Marketplace Commission GSTR-1 audit remediation.
// The pre-159aa export emitted one row per (seller, period) with a
// settlementCount column. CBIC §4 B2B is invoice-by-invoice: one row
// per tax invoice. This rewrite consumes the commission-invoice
// snapshot now stamped on each SellerSettlement (by
// CommissionInvoiceService) and emits:
//
//   §4 B2B    one row per invoice for GSTIN-registered recipients
//             with the snapshotted invoice number, invoice date, PoS,
//             recipient GSTIN, taxable value, CGST/SGST/IGST, IRN.
//   §7 B2C    aggregated per (place-of-supply state, rate) for
//             unregistered recipients (closes audit B3 — those rows
//             were silently dropped before, under-reporting outward
//             supplies on the marketplace's GSTR-1).
//   §9B CDNR  negative-net commission rows emit as credit-note rows
//             referencing the original invoice number (closes
//             audit #8).
//
// Also closes:
//   #6   Supplier GSTIN column from PlatformGstProfile snapshot.
//   #7   JSON export.
//   #9   Decimal arithmetic end-to-end (no float round-trip).
//   #10  Filing-period filter uses commissionInvoiceDate, not
//        cycle.periodEnd (legacy rows fall back to periodEnd).
//   #11  Place-of-supply column (per-row).
//   #14  Streaming CSV emit.
//   #15  taxSplit mid-period drift surfaced via per-invoice rows +
//        an audit warning collected on the aggregator's `warnings`.
//   #17  SAC + rate live in tax_config (config-default, snapshot).
//
// See:
//   - docs/tax/CA.md §A — commission supply, SAC 9985, B2B obligation
//   - commission-invoice.service.ts (issuance + denorm snapshot)

import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { SettlementsPublicFacade } from '../../../settlements/application/facades/settlements-public.facade';
import { escapeCsvField } from '../../../../core/utils/csv.util';
import { TaxConfigService } from './tax-config.service';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Phase 159aa (audit #7) — pinned CBIC layout. `2024-Q3` matches the
 * current upload template; older versions can be added here if a CA
 * needs to re-emit a historical return in its contemporary format.
 */
export const COMMISSION_GSTR1_SCHEMA_VERSIONS = {
  '2024-Q3': {
    b2bHeader: [
      'Supplier GSTIN',
      'Invoice Number',
      'Invoice Date',
      'Recipient GSTIN',
      'Recipient Legal Name',
      'Recipient State Code',
      'Place of Supply',
      'Filing Period',
      'SAC Code',
      'Rate (%)',
      'Taxable Value (Rupees)',
      'CGST (Rupees)',
      'SGST (Rupees)',
      'IGST (Rupees)',
      'Total GST (Rupees)',
      'Tax Split',
      'IRN',
    ],
    b2cHeader: [
      'Supplier GSTIN',
      'Place of Supply',
      'Filing Period',
      'SAC Code',
      'Rate (%)',
      'Taxable Value (Rupees)',
      'CGST (Rupees)',
      'SGST (Rupees)',
      'IGST (Rupees)',
      'Total GST (Rupees)',
      'Tax Split',
      'Settlement Count',
    ],
    cdnrHeader: [
      'Supplier GSTIN',
      'Credit Note Number',
      'Credit Note Date',
      'Original Invoice Number',
      'Recipient GSTIN',
      'Recipient State Code',
      'Place of Supply',
      'Filing Period',
      'SAC Code',
      'Rate (%)',
      'Taxable Value (Rupees) [Negative]',
      'CGST (Rupees) [Negative]',
      'SGST (Rupees) [Negative]',
      'IGST (Rupees) [Negative]',
      'Total GST (Rupees) [Negative]',
      'Tax Split',
    ],
  },
} as const;

export type CommissionGstr1SchemaVersion =
  keyof typeof COMMISSION_GSTR1_SCHEMA_VERSIONS;
export const CURRENT_COMMISSION_GSTR1_SCHEMA_VERSION: CommissionGstr1SchemaVersion =
  '2024-Q3';

export interface CommissionB2bRow {
  supplierGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  recipientGstin: string;
  recipientLegalName: string;
  recipientStateCode: string;
  placeOfSupplyStateCode: string;
  filingPeriod: string;
  sacCode: string;
  rateBps: number;
  commissionInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  totalGstInPaise: bigint;
  taxSplit: 'CGST_SGST' | 'IGST';
  irn: string | null;
}

export interface CommissionB2cBucket {
  supplierGstin: string;
  placeOfSupplyStateCode: string;
  filingPeriod: string;
  sacCode: string;
  rateBps: number;
  commissionInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  totalGstInPaise: bigint;
  taxSplit: 'CGST_SGST' | 'IGST';
  settlementCount: number;
}

export interface CommissionCreditNoteRow {
  supplierGstin: string;
  creditNoteNumber: string;
  creditNoteDate: string;
  originalInvoiceNumber: string;
  recipientGstin: string;
  recipientStateCode: string;
  placeOfSupplyStateCode: string;
  filingPeriod: string;
  sacCode: string;
  rateBps: number;
  commissionInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  totalGstInPaise: bigint;
  taxSplit: 'CGST_SGST' | 'IGST';
}

export interface CommissionAggregate {
  filingPeriod: string;
  supplierGstin: string;
  b2bRows: CommissionB2bRow[];
  b2cBuckets: CommissionB2cBucket[];
  creditNoteRows: CommissionCreditNoteRow[];
  warnings: string[];
  totals: {
    b2bInvoiceCount: number;
    b2cBucketCount: number;
    creditNoteCount: number;
    totalTaxableInPaise: bigint;
    totalGstInPaise: bigint;
  };
}

@Injectable()
export class MarketplaceCommissionGstrService {
  private readonly logger = new Logger(MarketplaceCommissionGstrService.name);

  constructor(
    private readonly settlementsFacade: SettlementsPublicFacade,
    private readonly taxConfig: TaxConfigService,
  ) {}

  /**
   * Phase 159aa — per-invoice aggregation. Reads commission-invoice
   * snapshots stamped on each SellerSettlement by
   * CommissionInvoiceService and partitions them into:
   *
   *   - b2b rows (§4 B2B): one row per invoice for GSTIN-registered
   *     recipients.
   *   - b2c buckets (§7 B2C): aggregated per (state, rate) for
   *     unregistered recipients.
   *   - credit-note rows (§9B): negative-net commission rows emit as
   *     §9B referencing the original invoice number.
   *
   * Legacy rows (no commission-invoice snapshot yet) still surface
   * via the cycle.periodEnd fallback in the facade query; they appear
   * in §4 B2B with empty invoice number when the seller has a GSTIN,
   * or get bucketed into §7 B2C otherwise.
   */
  async aggregate(args: {
    filingPeriod: string;
    supplierGstin: string;
  }): Promise<CommissionAggregate> {
    const { startUtc, endUtc } = monthRangeUtc(args.filingPeriod);
    const settlements =
      await this.settlementsFacade.listCommissionInvoicesForFilingPeriod({
        filingPeriod: args.filingPeriod,
        startUtc,
        endUtc,
      });

    const defaultRateBps = await this.taxConfig.getNumber(
      'commission_gst_rate_bps',
      1800,
    );
    const defaultSacCode = await this.taxConfig.getString(
      'commission_sac_code',
      '9985',
    );

    const b2bRows: CommissionB2bRow[] = [];
    // Key b2c buckets by (state, rate, split) so a CGST_SGST 18% bucket
    // and an IGST 18% bucket for the same state don't collapse.
    const b2cBuckets = new Map<string, CommissionB2cBucket>();
    const creditNoteRows: CommissionCreditNoteRow[] = [];
    const warnings: string[] = [];

    // Phase 159aa (audit #15) — track per-(seller, period) split drift.
    // If a seller's settlements in the same period carry both
    // CGST_SGST and IGST splits, that's a regulatory-significant
    // event (likely a mid-period GSTIN state change) and we surface
    // it via warnings so the CA reconciler sees it.
    const sellerSplitTracker = new Map<string, Set<'CGST_SGST' | 'IGST'>>();

    for (const s of settlements) {
      const commissionInPaise = resolveCommissionInPaise(s);
      const cgst = s.cgstOnCommissionInPaise ?? 0n;
      const sgst = s.sgstOnCommissionInPaise ?? 0n;
      const igst = s.igstOnCommissionInPaise ?? 0n;
      const totalGst = s.totalCommissionGstInPaise ?? 0n;
      const rateBps = s.commissionGstRateBps ?? defaultRateBps;
      const split: 'CGST_SGST' | 'IGST' =
        s.commissionGstSplitType === 'CGST_SGST' ? 'CGST_SGST' : 'IGST';
      const sacCode = s.commissionInvoiceSacCode ?? defaultSacCode;
      const posStateCode =
        s.commissionPlaceOfSupplyStateCode ??
        s.seller?.gstStateCode ??
        '99';

      // Track split drift for audit #15.
      const sellerSet =
        sellerSplitTracker.get(s.sellerId) ?? new Set<'CGST_SGST' | 'IGST'>();
      sellerSet.add(split);
      sellerSplitTracker.set(s.sellerId, sellerSet);

      // Phase 159aa (audit #8) — negative commission settlements emit
      // as §9B credit notes referencing the original invoice number.
      // The CommissionInvoiceService writes commissionInvoiceCreditNoteForId
      // when a credit note is explicitly issued; for legacy reversal
      // rows we still produce a credit-note line so the GSTR-1 isn't
      // silently under-reporting reversals.
      if (commissionInPaise < 0n || totalGst < 0n) {
        const cnDate = (s.commissionInvoiceDate ?? new Date()).toISOString().slice(0, 10);
        creditNoteRows.push({
          supplierGstin:
            s.commissionInvoiceSupplierGstin ?? args.supplierGstin,
          creditNoteNumber:
            s.commissionInvoiceNumber ?? `MKTCOM-CN-${s.settlementId.slice(0, 8)}`,
          creditNoteDate: cnDate,
          originalInvoiceNumber:
            s.commissionInvoiceCreditNoteForId ??
            s.commissionInvoiceNumber ??
            '',
          recipientGstin: s.commissionInvoiceRecipientGstin ?? s.seller?.gstin ?? '',
          recipientStateCode: s.seller?.gstStateCode ?? '',
          placeOfSupplyStateCode: posStateCode,
          filingPeriod: args.filingPeriod,
          sacCode,
          rateBps,
          commissionInPaise,
          cgstInPaise: cgst,
          sgstInPaise: sgst,
          igstInPaise: igst,
          totalGstInPaise: totalGst,
          taxSplit: split,
        });
        continue;
      }

      // B2C bucket for non-GSTIN recipients (closes audit B3 — these
      // rows were silently dropped before).
      if (s.commissionRecipientIsB2c || !s.commissionInvoiceRecipientGstin) {
        const key = `${posStateCode}|${rateBps}|${split}`;
        const existing = b2cBuckets.get(key) ?? {
          supplierGstin:
            s.commissionInvoiceSupplierGstin ?? args.supplierGstin,
          placeOfSupplyStateCode: posStateCode,
          filingPeriod: args.filingPeriod,
          sacCode,
          rateBps,
          commissionInPaise: 0n,
          cgstInPaise: 0n,
          sgstInPaise: 0n,
          igstInPaise: 0n,
          totalGstInPaise: 0n,
          taxSplit: split,
          settlementCount: 0,
        };
        existing.commissionInPaise += commissionInPaise;
        existing.cgstInPaise += cgst;
        existing.sgstInPaise += sgst;
        existing.igstInPaise += igst;
        existing.totalGstInPaise += totalGst;
        existing.settlementCount += 1;
        b2cBuckets.set(key, existing);
        continue;
      }

      // §4 B2B: one row per invoice. Empty invoice number is allowed
      // on legacy rows (pre-Phase-159aa) so the CA can re-issue and
      // refile.
      b2bRows.push({
        supplierGstin:
          s.commissionInvoiceSupplierGstin ?? args.supplierGstin,
        invoiceNumber: s.commissionInvoiceNumber ?? '',
        invoiceDate: (s.commissionInvoiceDate ?? s.cycle?.periodEnd ?? new Date()).toISOString().slice(0, 10),
        recipientGstin:
          s.commissionInvoiceRecipientGstin ?? s.seller?.gstin ?? '',
        recipientLegalName:
          s.seller?.legalBusinessName ??
          s.seller?.sellerShopName ??
          '',
        recipientStateCode: s.seller?.gstStateCode ?? '',
        placeOfSupplyStateCode: posStateCode,
        filingPeriod: args.filingPeriod,
        sacCode,
        rateBps,
        commissionInPaise,
        cgstInPaise: cgst,
        sgstInPaise: sgst,
        igstInPaise: igst,
        totalGstInPaise: totalGst,
        taxSplit: split,
        irn: s.commissionInvoiceIrn ?? null,
      });
    }

    // Phase 159aa (audit #15) — surface drift in audit warnings.
    for (const [sellerId, splits] of sellerSplitTracker) {
      if (splits.size > 1) {
        warnings.push(
          `Tax-split drift: seller ${sellerId} carries both CGST_SGST and ` +
            `IGST settlements in ${args.filingPeriod}. Likely a mid-period ` +
            `GSTIN state change — verify recipient state code and re-issue ` +
            `affected invoices if needed.`,
        );
      }
    }

    // Sort deterministically.
    b2bRows.sort((a, b) =>
      a.invoiceNumber.localeCompare(b.invoiceNumber) ||
      a.recipientGstin.localeCompare(b.recipientGstin),
    );
    creditNoteRows.sort((a, b) =>
      a.creditNoteNumber.localeCompare(b.creditNoteNumber),
    );
    const b2cArray = Array.from(b2cBuckets.values()).sort(
      (a, b) =>
        a.placeOfSupplyStateCode.localeCompare(b.placeOfSupplyStateCode) ||
        a.taxSplit.localeCompare(b.taxSplit),
    );

    const totalTaxableInPaise =
      sum(b2bRows.map((r) => r.commissionInPaise)) +
      sum(b2cArray.map((r) => r.commissionInPaise)) +
      sum(creditNoteRows.map((r) => r.commissionInPaise));
    const totalGstInPaise =
      sum(b2bRows.map((r) => r.totalGstInPaise)) +
      sum(b2cArray.map((r) => r.totalGstInPaise)) +
      sum(creditNoteRows.map((r) => r.totalGstInPaise));

    return {
      filingPeriod: args.filingPeriod,
      supplierGstin: args.supplierGstin,
      b2bRows,
      b2cBuckets: b2cArray,
      creditNoteRows,
      warnings,
      totals: {
        b2bInvoiceCount: b2bRows.length,
        b2cBucketCount: b2cArray.length,
        creditNoteCount: creditNoteRows.length,
        totalTaxableInPaise,
        totalGstInPaise,
      },
    };
  }

  /**
   * Phase 159aa — buffered CSV (used by tests + small periods). The
   * controller calls streamCsv(res) for production downloads.
   */
  async generateCsv(args: {
    filingPeriod: string;
    supplierGstin: string;
    schemaVersion?: string;
  }): Promise<string> {
    const layout = pickLayout(args.schemaVersion);
    const agg = await this.aggregate({
      filingPeriod: args.filingPeriod,
      supplierGstin: args.supplierGstin,
    });
    const lines: string[] = [];
    appendSectionTo(lines, '# §4 B2B', layout.b2bHeader, agg.b2bRows.map(b2bRowToCsv));
    appendSectionTo(lines, '# §7 B2C', layout.b2cHeader, agg.b2cBuckets.map(b2cBucketToCsv));
    appendSectionTo(lines, '# §9B CDNR', layout.cdnrHeader, agg.creditNoteRows.map(cdnrRowToCsv));
    return lines.join('\n');
  }

  /**
   * Phase 159aa (audit #14) — streaming CSV variant. Holds at most
   * one batch in memory; safe for 100k+ invoice periods.
   */
  async streamCsv(
    res: Response,
    args: { filingPeriod: string; supplierGstin: string; schemaVersion?: string },
  ): Promise<{ rowsEmitted: number; bytesWritten: number }> {
    const layout = pickLayout(args.schemaVersion);
    const agg = await this.aggregate({
      filingPeriod: args.filingPeriod,
      supplierGstin: args.supplierGstin,
    });
    let bytesWritten = 0;
    let rowsEmitted = 0;
    const writeLine = (line: string): void => {
      const payload = `${line}\n`;
      res.write(payload);
      bytesWritten += Buffer.byteLength(payload, 'utf8');
    };
    const writeSection = (
      label: string,
      header: readonly string[],
      rows: string[][],
    ): void => {
      writeLine(label);
      writeLine(header.join(','));
      for (const r of rows) {
        writeLine(r.join(','));
        rowsEmitted++;
      }
    };
    writeSection('# §4 B2B', layout.b2bHeader, agg.b2bRows.map(b2bRowToCsv));
    writeSection('# §7 B2C', layout.b2cHeader, agg.b2cBuckets.map(b2cBucketToCsv));
    writeSection('# §9B CDNR', layout.cdnrHeader, agg.creditNoteRows.map(cdnrRowToCsv));
    res.end();
    return { rowsEmitted, bytesWritten };
  }

  /**
   * Phase 159aa (audit #7) — NIC JSON envelope. The current pinned
   * version uses the same field names as the §4 B2B / §7 B2C / §9B
   * structures NIC accepts at the GSTR-1 portal.
   */
  async generateJsonPayload(args: {
    filingPeriod: string;
    supplierGstin: string;
    schemaVersion?: string;
  }): Promise<{
    gstin: string;
    ret_period: string;
    schema_version: string;
    b2b: Array<Record<string, unknown>>;
    b2cs: Array<Record<string, unknown>>;
    cdnr: Array<Record<string, unknown>>;
    warnings: string[];
    totals: {
      total_taxable_in_paise: string;
      total_gst_in_paise: string;
    };
  }> {
    const agg = await this.aggregate({
      filingPeriod: args.filingPeriod,
      supplierGstin: args.supplierGstin,
    });
    return {
      gstin: args.supplierGstin,
      ret_period: toRetPeriod(args.filingPeriod),
      schema_version:
        (args.schemaVersion as CommissionGstr1SchemaVersion) ??
        CURRENT_COMMISSION_GSTR1_SCHEMA_VERSION,
      b2b: agg.b2bRows.map((r) => ({
        inum: r.invoiceNumber,
        idt: r.invoiceDate,
        ctin: r.recipientGstin,
        pos: r.placeOfSupplyStateCode,
        rt: (r.rateBps / 100).toFixed(2),
        sac: r.sacCode,
        txval_in_paise: r.commissionInPaise.toString(),
        camt_in_paise: r.cgstInPaise.toString(),
        samt_in_paise: r.sgstInPaise.toString(),
        iamt_in_paise: r.igstInPaise.toString(),
        total_gst_in_paise: r.totalGstInPaise.toString(),
        tax_split: r.taxSplit,
        irn: r.irn,
      })),
      b2cs: agg.b2cBuckets.map((b) => ({
        pos: b.placeOfSupplyStateCode,
        sac: b.sacCode,
        rt: (b.rateBps / 100).toFixed(2),
        txval_in_paise: b.commissionInPaise.toString(),
        camt_in_paise: b.cgstInPaise.toString(),
        samt_in_paise: b.sgstInPaise.toString(),
        iamt_in_paise: b.igstInPaise.toString(),
        total_gst_in_paise: b.totalGstInPaise.toString(),
        tax_split: b.taxSplit,
        settlement_count: b.settlementCount,
      })),
      cdnr: agg.creditNoteRows.map((r) => ({
        ntty: 'C',
        nt_num: r.creditNoteNumber,
        nt_dt: r.creditNoteDate,
        inum: r.originalInvoiceNumber,
        ctin: r.recipientGstin,
        pos: r.placeOfSupplyStateCode,
        sac: r.sacCode,
        rt: (r.rateBps / 100).toFixed(2),
        txval_in_paise: r.commissionInPaise.toString(),
        camt_in_paise: r.cgstInPaise.toString(),
        samt_in_paise: r.sgstInPaise.toString(),
        iamt_in_paise: r.igstInPaise.toString(),
        total_gst_in_paise: r.totalGstInPaise.toString(),
        tax_split: r.taxSplit,
      })),
      warnings: agg.warnings,
      totals: {
        total_taxable_in_paise: agg.totals.totalTaxableInPaise.toString(),
        total_gst_in_paise: agg.totals.totalGstInPaise.toString(),
      },
    };
  }

  /**
   * Phase 159aa (audit #16) — summary endpoint for the admin preview
   * table. Renders the three section counts + headline totals + the
   * warning list (so split drift surfaces in the UI).
   */
  async summarise(args: {
    filingPeriod: string;
    supplierGstin: string;
  }): Promise<{
    filingPeriod: string;
    supplierGstin: string;
    totals: CommissionAggregate['totals'];
    warnings: string[];
    sample: {
      b2b: CommissionB2bRow[];
      b2cs: CommissionB2cBucket[];
      cdnr: CommissionCreditNoteRow[];
    };
  }> {
    const agg = await this.aggregate(args);
    return {
      filingPeriod: agg.filingPeriod,
      supplierGstin: agg.supplierGstin,
      totals: agg.totals,
      warnings: agg.warnings,
      sample: {
        b2b: agg.b2bRows.slice(0, 25),
        b2cs: agg.b2cBuckets.slice(0, 25),
        cdnr: agg.creditNoteRows.slice(0, 25),
      },
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function pickLayout(version?: string) {
  const key = (version ?? CURRENT_COMMISSION_GSTR1_SCHEMA_VERSION) as CommissionGstr1SchemaVersion;
  return (
    COMMISSION_GSTR1_SCHEMA_VERSIONS[key] ??
    COMMISSION_GSTR1_SCHEMA_VERSIONS[CURRENT_COMMISSION_GSTR1_SCHEMA_VERSION]
  );
}

function appendSectionTo(
  lines: string[],
  label: string,
  header: readonly string[],
  rows: string[][],
): void {
  lines.push(label);
  lines.push(header.join(','));
  for (const r of rows) lines.push(r.join(','));
}

function b2bRowToCsv(r: CommissionB2bRow): string[] {
  return [
    csvCell(r.supplierGstin),
    csvCell(r.invoiceNumber),
    csvCell(r.invoiceDate),
    csvCell(r.recipientGstin),
    csvCell(r.recipientLegalName),
    csvCell(r.recipientStateCode),
    csvCell(r.placeOfSupplyStateCode),
    csvCell(r.filingPeriod),
    csvCell(r.sacCode),
    (r.rateBps / 100).toFixed(2),
    paiseToRupees(r.commissionInPaise),
    paiseToRupees(r.cgstInPaise),
    paiseToRupees(r.sgstInPaise),
    paiseToRupees(r.igstInPaise),
    paiseToRupees(r.totalGstInPaise),
    csvCell(r.taxSplit),
    csvCell(r.irn ?? ''),
  ];
}

function b2cBucketToCsv(b: CommissionB2cBucket): string[] {
  return [
    csvCell(b.supplierGstin),
    csvCell(b.placeOfSupplyStateCode),
    csvCell(b.filingPeriod),
    csvCell(b.sacCode),
    (b.rateBps / 100).toFixed(2),
    paiseToRupees(b.commissionInPaise),
    paiseToRupees(b.cgstInPaise),
    paiseToRupees(b.sgstInPaise),
    paiseToRupees(b.igstInPaise),
    paiseToRupees(b.totalGstInPaise),
    csvCell(b.taxSplit),
    b.settlementCount.toString(),
  ];
}

function cdnrRowToCsv(r: CommissionCreditNoteRow): string[] {
  return [
    csvCell(r.supplierGstin),
    csvCell(r.creditNoteNumber),
    csvCell(r.creditNoteDate),
    csvCell(r.originalInvoiceNumber),
    csvCell(r.recipientGstin),
    csvCell(r.recipientStateCode),
    csvCell(r.placeOfSupplyStateCode),
    csvCell(r.filingPeriod),
    csvCell(r.sacCode),
    (r.rateBps / 100).toFixed(2),
    paiseToRupees(r.commissionInPaise),
    paiseToRupees(r.cgstInPaise),
    paiseToRupees(r.sgstInPaise),
    paiseToRupees(r.igstInPaise),
    paiseToRupees(r.totalGstInPaise),
    csvCell(r.taxSplit),
  ];
}

// Phase 159x (audit B5) — delegate to the shared core helper
// (RFC-4180 + CWE-1236 formula-injection guard).
function csvCell(value: string): string {
  return escapeCsvField(value);
}

function paiseToRupees(p: bigint): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const rupees = `${whole.toString()}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${rupees}` : rupees;
}

function sum(values: bigint[]): bigint {
  let acc = 0n;
  for (const v of values) acc += v;
  return acc;
}

/** "2026-04" → "042026" per CBIC MMYYYY convention. */
function toRetPeriod(filingPeriod: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(filingPeriod);
  if (!m) return filingPeriod;
  return `${m[2]}${m[1]}`;
}

/**
 * Phase 159aa (audit #9) — Decimal-aware commission resolver. The
 * legacy float round-trip (Number(decimal.toString()) * 100) is
 * replaced with Prisma.Decimal arithmetic so values that exceed
 * Number.MAX_SAFE_INTEGER's 2^53 ceiling stay exact.
 */
function resolveCommissionInPaise(s: {
  totalPlatformMarginInPaise: bigint | null;
  totalPlatformMargin: number;
}): bigint {
  if (s.totalPlatformMarginInPaise != null) return s.totalPlatformMarginInPaise;
  const dec = new Prisma.Decimal(s.totalPlatformMargin || 0).mul(100);
  const rounded = dec.round();
  return BigInt(rounded.toFixed(0));
}

/**
 * Convert "YYYY-MM" filing period → IST month UTC bounds.
 * Apr 2026 → start = 1 Apr 2026 00:00 IST = 31 Mar 2026 18:30 UTC.
 */
function monthRangeUtc(filingPeriod: string): {
  startUtc: Date;
  endUtc: Date;
} {
  const m = /^(\d{4})-(\d{2})$/.exec(filingPeriod);
  if (!m) {
    throw new Error(`Invalid filing period: "${filingPeriod}" (expected YYYY-MM)`);
  }
  const y = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const startUtc = new Date(
    Date.UTC(y, month - 1, 1, 0, 0, 0) - IST_OFFSET_MS,
  );
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? y + 1 : y;
  const endUtc = new Date(
    Date.UTC(endYear, endMonth - 1, 1, 0, 0, 0) - IST_OFFSET_MS,
  );
  return { startUtc, endUtc };
}
