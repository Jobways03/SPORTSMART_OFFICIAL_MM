// Phase 18 GST — Gstr1ReportService.
//
// Builds per-seller GSTR-1 reports (CBIC's outward-supply return).
// Sportsmart isn't the supplier on marketplace sales — the seller is.
// Each seller files their own GSTR-1; this service produces the
// supporting CSV / JSON that the seller can hand to their CA or
// upload via NIC.
//
// Sections produced:
//   §4  B2B (per invoice, recipient has GSTIN)
//   §5  B2C Large (inter-state, unregistered, > ₹2.5L)
//   §7  B2C Small (state + rate aggregate)
//   §9B Credit notes (per credit note)
//   §12 HSN-wise summary
//   §13 Documents issued (count by type)
//
// Filtering scope: only documents with `sellerId = ?` (excludes
// OWN_BRAND / SPORTSMART platform-direct supplies). Documents in
// VOIDED_DRAFT / SUPERSEDED are excluded — they're never legally
// issued.
//
// See:
//   - apps/api/src/modules/tax/domain/gstr1-aggregator.ts (pure bucketing)
//   - docs/tax/CA.md §A Phase 18 log

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { escapeCsvField } from '../../../../core/utils/csv.util';
import { BadRequestAppException } from '../../../../core/exceptions';
import {
  aggregateGstr1,
  type Gstr1Aggregate,
} from '../../domain/gstr1-aggregator';

// Phase 159x (audit #14) — IST is UTC+05:30 and India observes no DST, so a
// fixed offset is correct; naming it removes the bare 5.5*60*60*1000 literal.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface Gstr1Section4Csv {
  section: 'B2B';
  rows: Array<{
    invoice_number: string;
    invoice_date: string;
    buyer_gstin: string;
    place_of_supply: string;
    invoice_value_rupees: string;
    taxable_value_rupees: string;
    cgst_rupees: string;
    sgst_rupees: string;
    igst_rupees: string;
    cess_rupees: string;
    reverse_charge: string;
  }>;
}

@Injectable()
export class Gstr1ReportService {
  private readonly logger = new Logger(Gstr1ReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate every TAX_INVOICE / INVOICE_CUM_BILL_OF_SUPPLY /
   * BILL_OF_SUPPLY / CREDIT_NOTE / LEGACY_RECEIPT for the seller in
   * the requested IST month. Returns the structured aggregate shape;
   * callers serialise to CSV / JSON downstream.
   */
  async aggregateForSeller(args: {
    sellerId: string;
    filingPeriod: string; // "YYYY-MM"
  }): Promise<Gstr1Aggregate> {
    // Phase 159x (audit #12) — fail fast on an invalid seller rather than
    // silently emitting empty CSVs. A GSTR-1 only makes sense for a real,
    // GST-registered seller.
    const seller = await this.prisma.seller.findUnique({
      where: { id: args.sellerId },
      select: {
        id: true,
        gstins: {
          where: { verifiedAt: { not: null } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!seller) {
      throw new BadRequestAppException(`Seller ${args.sellerId} not found`);
    }
    if (seller.gstins.length === 0) {
      throw new BadRequestAppException(
        `Seller ${args.sellerId} has no verified GSTIN; cannot generate GSTR-1`,
      );
    }

    const { startUtc, endUtc } = monthRangeUtc(args.filingPeriod);
    const docs = await this.prisma.taxDocument.findMany({
      where: {
        sellerId: args.sellerId,
        generatedAt: { gte: startUtc, lt: endUtc },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      include: { lines: true },
      orderBy: { generatedAt: 'asc' },
    });
    const agg = aggregateGstr1(docs);
    // Phase 159x (audit B3/#8) — surface data-integrity warnings (e.g. a
    // taxable invoice with no line items whose rate was back-calculated) so
    // they don't pass silently into the filed return.
    if (agg.warnings.length > 0) {
      this.logger.warn(
        `GSTR-1 ${args.filingPeriod} seller=${args.sellerId}: ` +
          `${agg.warnings.length} data-integrity warning(s): ${agg.warnings.join(' | ')}`,
      );
    }
    return agg;
  }

  /**
   * Phase 159x (audit #17) — section-wise counts + headline totals so the
   * admin UI can preview a filing period without downloading all 6 CSVs.
   */
  async previewForSeller(args: { sellerId: string; filingPeriod: string }) {
    const agg = await this.aggregateForSeller(args);
    return {
      sellerId: args.sellerId,
      filingPeriod: args.filingPeriod,
      counts: {
        b2b: agg.b2b.length,
        b2cLarge: agg.b2cLarge.length,
        b2cSmall: agg.b2cSmall.length,
        creditNotes: agg.creditNotes.filter((n) => n.noteType === 'CREDIT').length,
        debitNotes: agg.creditNotes.filter((n) => n.noteType === 'DEBIT').length,
        hsn: agg.hsn.length,
        documentsIssued: agg.documentsIssued.reduce((s, d) => s + d.count, 0),
      },
      totals: {
        taxableRupees: paiseToRupees(agg.totals.taxableInPaise),
        cgstRupees: paiseToRupees(agg.totals.cgstInPaise),
        sgstRupees: paiseToRupees(agg.totals.sgstInPaise),
        igstRupees: paiseToRupees(agg.totals.igstInPaise),
        cessRupees: paiseToRupees(agg.totals.cessInPaise),
        invoiceValueRupees: paiseToRupees(agg.totals.invoiceValueInPaise),
        creditNoteValueRupees: paiseToRupees(agg.totals.creditNoteValueInPaise),
        debitNoteValueRupees: paiseToRupees(agg.totals.debitNoteValueInPaise),
      },
      warnings: agg.warnings,
    };
  }

  /**
   * Build the §4 B2B CSV body. Returns the full CSV file contents.
   * Header columns are load-bearing for upload tooling.
   */
  async generateB2bCsv(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<string> {
    const agg = await this.aggregateForSeller(args);
    // Phase 159x (audit B2) — IRN + IRN Date appended for the NIC B2B upload.
    const header =
      'Invoice Number,Invoice Date,Buyer GSTIN,Place of Supply,Invoice Value,Taxable Value,CGST,SGST,IGST,Cess,Reverse Charge,IRN,IRN Date';
    const rows = agg.b2b.map((r) =>
      [
        csvCell(r.documentNumber),
        csvCell(r.documentDate.toISOString().slice(0, 10)),
        csvCell(r.buyerGstin),
        csvCell(r.placeOfSupplyStateCode ?? ''),
        paiseToRupees(r.invoiceValueInPaise),
        paiseToRupees(r.taxableInPaise),
        paiseToRupees(r.cgstInPaise),
        paiseToRupees(r.sgstInPaise),
        paiseToRupees(r.igstInPaise),
        paiseToRupees(r.cessInPaise),
        r.reverseChargeApplicable ? 'Y' : 'N',
        csvCell(r.irn ?? ''),
        csvCell(r.irnDate ? r.irnDate.toISOString().slice(0, 10) : ''),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  /** §5 B2C Large CSV body. */
  async generateB2cLargeCsv(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<string> {
    const agg = await this.aggregateForSeller(args);
    const header =
      'Invoice Number,Invoice Date,Place of Supply,Invoice Value,Taxable Value,CGST,SGST,IGST,Cess';
    const rows = agg.b2cLarge.map((r) =>
      [
        csvCell(r.documentNumber),
        csvCell(r.documentDate.toISOString().slice(0, 10)),
        csvCell(r.placeOfSupplyStateCode),
        paiseToRupees(r.invoiceValueInPaise),
        paiseToRupees(r.taxableInPaise),
        paiseToRupees(r.cgstInPaise),
        paiseToRupees(r.sgstInPaise),
        paiseToRupees(r.igstInPaise),
        paiseToRupees(r.cessInPaise),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  /** §7 B2C Small CSV body (state + rate aggregate). */
  async generateB2cSmallCsv(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<string> {
    const agg = await this.aggregateForSeller(args);
    const header =
      'Place of Supply,GST Rate %,Taxable Value,CGST,SGST,IGST,Cess';
    const rows = agg.b2cSmall.map((r) =>
      [
        csvCell(r.placeOfSupplyStateCode),
        (r.gstRateBps / 100).toFixed(2),
        paiseToRupees(r.taxableInPaise),
        paiseToRupees(r.cgstInPaise),
        paiseToRupees(r.sgstInPaise),
        paiseToRupees(r.igstInPaise),
        paiseToRupees(r.cessInPaise),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  /** §9B Credit notes CSV body. */
  async generateCreditNoteCsv(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<string> {
    const agg = await this.aggregateForSeller(args);
    // Phase 159x (audit — DEBIT_NOTE) — §9B carries both credit and debit
    // notes; the Note Type column distinguishes them for the NIC upload.
    const header =
      'Note Number,Note Date,Note Type,Original Invoice Number,Buyer GSTIN,Buyer Type,Place of Supply,Note Value,Taxable Reversal,CGST Reversal,SGST Reversal,IGST Reversal,Cess Reversal';
    const rows = agg.creditNotes.map((r) =>
      [
        csvCell(r.documentNumber),
        csvCell(r.documentDate.toISOString().slice(0, 10)),
        r.noteType,
        csvCell(r.originalInvoiceNumber),
        csvCell(r.buyerGstin ?? ''),
        r.buyerType,
        csvCell(r.placeOfSupplyStateCode ?? ''),
        paiseToRupees(r.noteValueInPaise),
        paiseToRupees(r.taxableReversalInPaise),
        paiseToRupees(r.cgstReversalInPaise),
        paiseToRupees(r.sgstReversalInPaise),
        paiseToRupees(r.igstReversalInPaise),
        paiseToRupees(r.cessReversalInPaise),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  /** §12 HSN summary CSV body. */
  async generateHsnSummaryCsv(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<string> {
    const agg = await this.aggregateForSeller(args);
    const header =
      'HSN/SAC,UQC,GST Rate %,Total Quantity,Total Value,Taxable Value,CGST,SGST,IGST,Cess';
    const rows = agg.hsn.map((r) =>
      [
        csvCell(r.hsnOrSacCode),
        csvCell(r.uqcCode ?? ''),
        (r.gstRateBps / 100).toFixed(2),
        r.totalQuantity.toString(),
        paiseToRupees(r.totalValueInPaise),
        paiseToRupees(r.taxableInPaise),
        paiseToRupees(r.cgstInPaise),
        paiseToRupees(r.sgstInPaise),
        paiseToRupees(r.igstInPaise),
        paiseToRupees(r.cessInPaise),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  /** §13 Documents issued CSV body. */
  async generateDocumentsIssuedCsv(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<string> {
    const agg = await this.aggregateForSeller(args);
    const header = 'Document Type,Count';
    const rows = agg.documentsIssued.map((r) =>
      [csvCell(r.documentType), r.count.toString()].join(','),
    );
    return [header, ...rows].join('\n');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function paiseToRupees(p: bigint): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const rupees = `${whole.toString()}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${rupees}` : rupees;
}

// Phase 159x (audit B1) — delegate to the shared core helper, which adds the
// CSV/formula-injection guard (CWE-1236: leading = + - @ TAB CR neutralised
// with a `'` prefix) on top of RFC-4180 quoting. The prior local impl quoted
// commas/quotes/newlines only — a `=cmd|'/c calc'!A1` invoice number landed in
// Excel as a live formula.
function csvCell(value: string): string {
  return escapeCsvField(value);
}

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
  const startUtc = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 0 : m;
  const endUtc = new Date(Date.UTC(nextY, nextM, 1) - IST_OFFSET_MS);
  return { startUtc, endUtc };
}
