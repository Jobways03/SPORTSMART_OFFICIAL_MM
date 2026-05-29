// Phase 18 GST — Gstr3bReportService.
//
// Builds per-seller GSTR-3B OUTWARD-supply sections (3.1 + 3.2) from
// marketplace sales. GSTR-3B is the monthly return that summarises every
// seller's outward + inward + ITC + tax payable. Sportsmart can only
// contribute the OUTWARD half from marketplace sales — the seller's own books
// carry inward (§3.1(d)), ITC (§4), exempt inward (§5), tax payable (§6.1),
// interest/late fee (§6.2) and TDS/TCS credit (§7). Those are intentionally
// NOT in this export; the CSV disclaimer + endpoint naming say so (audit #7/B4).
//
// What we produce:
//   §3.1(a) Outward taxable supplies (other than zero/nil/exempt)
//   §3.1(b) Outward zero-rated supplies            (Phase 159y, audit #2)
//   §3.1(c) Other outward supplies (nil/exempted)  (Phase 159y, audit #2)
//   §3.1(e) Non-GST outward supplies               (Phase 159y, audit #2)
//   §3.2    Inter-state supplies to unregistered persons, by place of supply
//
// See:
//   - apps/api/src/modules/tax/domain/gstr1-aggregator.ts (shared math)
//   - docs/tax/CA.md §A Phase 18 log

import { Injectable, Logger } from '@nestjs/common';
import type { TaxDocument, TaxDocumentLine } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { escapeCsvField } from '../../../../core/utils/csv.util';
import { BadRequestAppException } from '../../../../core/exceptions';
import {
  aggregateGstr1,
  type Gstr1Aggregate,
} from '../../domain/gstr1-aggregator';

// Phase 159y (audit #5) — IST is UTC+05:30, no DST; named constant replaces the
// bare 5.5*60*60*1000 literal.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface Gstr3bSection31 {
  outwardTaxableInPaise: bigint; // 3.1(a) excluding zero/nil/exempt
  outwardZeroRatedInPaise: bigint; // 3.1(b)
  otherOutwardInPaise: bigint; // 3.1(c) nil-rated + exempted
  nonGstOutwardInPaise: bigint; // 3.1(e)
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  cessInPaise: bigint;
}

export interface Gstr3bSection32Row {
  placeOfSupplyStateCode: string;
  totalTaxableInPaise: bigint;
  totalIgstInPaise: bigint;
}

export interface Gstr3bSummary {
  filingPeriod: string;
  sellerId: string;
  section31: Gstr3bSection31;
  section32: Gstr3bSection32Row[];
  // Phase 159y (audit #6/#11) — data-integrity / filing notes surfaced to the
  // CA (zero-period, net-negative clamp, mixed taxable+exempt invoices).
  warnings: string[];
}

interface SupplyTaxabilityBuckets {
  zeroRatedInPaise: bigint; // §3.1(b)
  nilExemptInPaise: bigint; // §3.1(c)
  nonGstInPaise: bigint; // §3.1(e)
}

type DocWithLines = TaxDocument & { lines: TaxDocumentLine[] };

@Injectable()
export class Gstr3bReportService {
  private readonly logger = new Logger(Gstr3bReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate the seller's outward supplies for the period into GSTR-3B
   * sections 3.1 + 3.2. Credit notes net §3.1(a); debit notes add to it
   * (audit #14); §3.1(b/c/e) come from per-line supply classification.
   */
  async summariseForSeller(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<Gstr3bSummary> {
    // Phase 159y (audit #10) — fail fast on an invalid seller instead of
    // emitting an all-zero CSV that looks like a real (empty) return.
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
        `Seller ${args.sellerId} has no verified GSTIN; cannot generate GSTR-3B`,
      );
    }

    const { startUtc, endUtc } = monthRangeUtc(args.filingPeriod);
    const docs = (await this.prisma.taxDocument.findMany({
      where: {
        sellerId: args.sellerId,
        generatedAt: { gte: startUtc, lt: endUtc },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      include: { lines: true },
    })) as DocWithLines[];

    const warnings: string[] = [];
    if (docs.length === 0) {
      // Phase 159y (audit #11) — distinguish "zero supplies" from "we forgot
      // to process invoices".
      warnings.push(
        'No outward documents found for this period — every section is zero. ' +
          'Confirm invoices for the period were generated before filing.',
      );
    }

    const agg = aggregateGstr1(docs);
    const buckets = buildSupplyTaxabilityBuckets(docs, warnings);
    const section31 = buildSection31(agg, buckets, warnings);
    const section32 = buildSection32(agg);

    if (warnings.length > 0) {
      this.logger.warn(
        `GSTR-3B ${args.filingPeriod} seller=${args.sellerId}: ${warnings.length} note(s): ${warnings.join(' | ')}`,
      );
    }

    return {
      filingPeriod: args.filingPeriod,
      sellerId: args.sellerId,
      section31,
      section32,
      warnings,
    };
  }

  /**
   * Build the GSTR-3B CSV — §3.1 + §3.2, with a disclaimer header making clear
   * this is the outward half only (audit #1 / #7).
   */
  async generateCsv(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<string> {
    const summary = await this.summariseForSeller(args);
    const lines: string[] = [];

    // Phase 159y (audit #7/B4) — honesty header so a CA can't mistake this for
    // a complete, filing-ready GSTR-3B.
    lines.push(
      '# GSTR-3B OUTWARD SUPPLIES (Sections 3.1 + 3.2) — derived from marketplace sales.',
    );
    lines.push(
      "# Inward reverse-charge (3.1d), ITC (4), exempt inward (5), tax payable (6.1),",
    );
    lines.push(
      "# interest/late fee (6.2) and TDS/TCS credit (7) must be completed from the",
    );
    lines.push('# seller\'s own books. This file is NOT a complete GSTR-3B.');
    for (const w of summary.warnings) {
      lines.push(`# WARNING: ${w.replace(/[\r\n]+/g, ' ')}`);
    }

    // ── Section 3.1 ──
    lines.push('Section,Description,Taxable Value,CGST,SGST,IGST,Cess');
    lines.push(
      [
        '3.1(a)',
        csvCell('Outward taxable supplies (other than zero/nil/exempt)'),
        paiseToRupees(summary.section31.outwardTaxableInPaise),
        paiseToRupees(summary.section31.cgstInPaise),
        paiseToRupees(summary.section31.sgstInPaise),
        paiseToRupees(summary.section31.igstInPaise),
        paiseToRupees(summary.section31.cessInPaise),
      ].join(','),
    );
    lines.push(
      [
        '3.1(b)',
        csvCell('Outward taxable supplies (zero-rated)'),
        paiseToRupees(summary.section31.outwardZeroRatedInPaise),
        '0.00',
        '0.00',
        '0.00',
        '0.00',
      ].join(','),
    );
    lines.push(
      [
        '3.1(c)',
        csvCell('Other outward supplies (nil-rated, exempted)'),
        paiseToRupees(summary.section31.otherOutwardInPaise),
        '0.00',
        '0.00',
        '0.00',
        '0.00',
      ].join(','),
    );
    lines.push(
      [
        '3.1(e)',
        csvCell('Non-GST outward supplies'),
        paiseToRupees(summary.section31.nonGstOutwardInPaise),
        '0.00',
        '0.00',
        '0.00',
        '0.00',
      ].join(','),
    );

    // ── Section 3.2 (audit #1 — was computed but never serialised) ──
    lines.push('');
    lines.push(
      'Section 3.2 — Inter-state supplies to unregistered persons (by place of supply)',
    );
    lines.push('Place of Supply,Taxable Value,IGST');
    for (const r of summary.section32) {
      lines.push(
        [
          csvCell(r.placeOfSupplyStateCode),
          paiseToRupees(r.totalTaxableInPaise),
          paiseToRupees(r.totalIgstInPaise),
        ].join(','),
      );
    }

    return lines.join('\n');
  }
}

/**
 * Phase 159y (audit #2) — per-line supply classification for §3.1(b/c/e).
 * Walks the OUTWARD documents' lines and buckets their taxable value by
 * supplyTaxability. A line with no classification (pre-159y data, or the POS
 * path) defaults to TAXABLE and stays in §3.1(a). A document that mixes
 * taxable + non-taxable lines is flagged (the only case where §3.1(a)'s
 * document-total and §3.1(c)'s line-sum could overlap).
 */
function buildSupplyTaxabilityBuckets(
  docs: DocWithLines[],
  warnings: string[],
): SupplyTaxabilityBuckets {
  let zeroRated = 0n;
  let nilExempt = 0n;
  let nonGst = 0n;
  const OUTWARD = new Set([
    'TAX_INVOICE',
    'INVOICE_CUM_BILL_OF_SUPPLY',
    'BILL_OF_SUPPLY',
  ]);
  for (const d of docs) {
    if (!OUTWARD.has(d.documentType)) continue;
    let hasTaxable = false;
    let hasNonTaxable = false;
    for (const line of d.lines ?? []) {
      const t = line.supplyTaxability ?? 'TAXABLE';
      if (t === 'ZERO_RATED') {
        zeroRated += line.taxableAmountInPaise;
        hasNonTaxable = true;
      } else if (t === 'NIL_RATED' || t === 'EXEMPT') {
        nilExempt += line.taxableAmountInPaise;
        hasNonTaxable = true;
      } else if (t === 'NON_GST' || t === 'OUT_OF_SCOPE') {
        nonGst += line.taxableAmountInPaise;
        hasNonTaxable = true;
      } else {
        hasTaxable = true; // TAXABLE
      }
    }
    if (hasTaxable && hasNonTaxable) {
      warnings.push(
        `Document ${d.documentNumber} mixes taxable and non-taxable lines; ` +
          `verify the §3.1(a) vs §3.1(b/c/e) split for this invoice.`,
      );
    }
  }
  return {
    zeroRatedInPaise: zeroRated,
    nilExemptInPaise: nilExempt,
    nonGstInPaise: nonGst,
  };
}

function buildSection31(
  agg: Gstr1Aggregate,
  buckets: SupplyTaxabilityBuckets,
  warnings: string[],
): Gstr3bSection31 {
  // §3.1(a) gross = document-level outward taxable totals (TAX_INVOICE +
  // INVOICE_CUM). Kept document-total based so it doesn't shift for the common
  // all-taxable invoice.
  let taxable = agg.totals.taxableInPaise;
  let cgst = agg.totals.cgstInPaise;
  let sgst = agg.totals.sgstInPaise;
  let igst = agg.totals.igstInPaise;
  let cess = agg.totals.cessInPaise;

  // Net the notes. Per CBIC, GSTR-3B §3.1(a) is a CONSOLIDATED net figure:
  // credit notes reduce it, debit notes increase it — for B2B AND B2C alike
  // (the B2B/B2C split is a GSTR-1 §9B concept, not a 3B one). Audit #14:
  // debit notes were previously dropped, then (post-aggregator-fix) wrongly
  // subtracted; the noteType sign corrects both.
  for (const note of agg.creditNotes) {
    const sign = note.noteType === 'DEBIT' ? 1n : -1n;
    taxable += sign * note.taxableReversalInPaise;
    cgst += sign * note.cgstReversalInPaise;
    sgst += sign * note.sgstReversalInPaise;
    igst += sign * note.igstReversalInPaise;
    cess += sign * note.cessReversalInPaise;
  }

  // Phase 159y (audit #6) — surface, don't silently hide, a net-negative
  // period (heavy returns / prior-period credit notes). CBIC clamps 3B to 0
  // and the excess carries forward in the seller's books.
  if (taxable < 0n) {
    warnings.push(
      `Net outward taxable for the period is negative (₹${paiseToRupees(-taxable)}); ` +
        `clamped to 0 per CBIC. Carry the excess forward in the seller's own books.`,
    );
  }

  return {
    outwardTaxableInPaise: taxable < 0n ? 0n : taxable,
    // Phase 159y (audit #2) — real values from per-line classification.
    outwardZeroRatedInPaise: buckets.zeroRatedInPaise,
    otherOutwardInPaise: buckets.nilExemptInPaise,
    nonGstOutwardInPaise: buckets.nonGstInPaise,
    cgstInPaise: cgst < 0n ? 0n : cgst,
    sgstInPaise: sgst < 0n ? 0n : sgst,
    igstInPaise: igst < 0n ? 0n : igst,
    cessInPaise: cess < 0n ? 0n : cess,
  };
}

function buildSection32(agg: Gstr1Aggregate): Gstr3bSection32Row[] {
  // 3.2 = inter-state B2C supplies (B2C Large + inter-state B2C Small) by
  // place of supply, from the GSTR-1 B2C buckets.
  const map = new Map<string, Gstr3bSection32Row>();
  for (const r of agg.b2cLarge) {
    upsert32(map, r.placeOfSupplyStateCode, r.taxableInPaise, r.igstInPaise);
  }
  for (const r of agg.b2cSmall) {
    // Only inter-state B2C Small contributes to 3.2 — distinguished by IGST > 0.
    if (r.igstInPaise > 0n) {
      upsert32(map, r.placeOfSupplyStateCode, r.taxableInPaise, r.igstInPaise);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.placeOfSupplyStateCode.localeCompare(b.placeOfSupplyStateCode),
  );
}

function upsert32(
  map: Map<string, Gstr3bSection32Row>,
  state: string,
  taxable: bigint,
  igst: bigint,
): void {
  const existing = map.get(state);
  if (existing) {
    existing.totalTaxableInPaise += taxable;
    existing.totalIgstInPaise += igst;
  } else {
    map.set(state, {
      placeOfSupplyStateCode: state,
      totalTaxableInPaise: taxable,
      totalIgstInPaise: igst,
    });
  }
}

function paiseToRupees(p: bigint): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const rupees = `${whole.toString()}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${rupees}` : rupees;
}

// Phase 159x (audit B1) — delegate to the shared core helper (RFC-4180 +
// CWE-1236 formula-injection guard). See gstr1-report.service.ts.
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
