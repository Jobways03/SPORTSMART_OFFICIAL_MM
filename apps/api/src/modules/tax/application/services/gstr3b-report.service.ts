// Phase 18 GST — Gstr3bReportService.
//
// Builds per-seller GSTR-3B Section 3.1 (outward taxable supplies)
// summaries. GSTR-3B is the monthly return that summarises every
// seller's outward + inward + ITC + tax payable. Sportsmart can only
// contribute the OUTWARD half from marketplace sales — the seller's
// own books carry inward + ITC + non-marketplace outward.
//
// What we produce (Section 3.1 only):
//   (a) Outward taxable supplies (other than zero/nil/exempted)
//   (b) Outward taxable supplies (zero-rated) — empty for marketplace
//       since we don't yet handle exports
//   (c) Other outward supplies (nil-rated, exempted)
//   (d) Inward supplies (liable to reverse charge)         — N/A
//   (e) Non-GST outward supplies
//
// Section 3.2 (interstate B2C supplies by state) is also marketplace-
// relevant and emitted in the same shape — derived from the GSTR-1
// §5 + §7 aggregates.
//
// See:
//   - apps/api/src/modules/tax/domain/gstr1-aggregator.ts (shared math)
//   - docs/tax/CA.md §A Phase 18 log

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  aggregateGstr1,
  type Gstr1Aggregate,
} from '../../domain/gstr1-aggregator';

export interface Gstr3bSection31 {
  outwardTaxableInPaise: bigint;          // 3.1(a) excluding zero/nil/exempt
  outwardZeroRatedInPaise: bigint;        // 3.1(b)
  otherOutwardInPaise: bigint;            // 3.1(c) nil-rated + exempted
  nonGstOutwardInPaise: bigint;           // 3.1(e)
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
}

@Injectable()
export class Gstr3bReportService {
  private readonly logger = new Logger(Gstr3bReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate the seller's outward supplies for the period and
   * shape the result into GSTR-3B sections 3.1 + 3.2.
   *
   * Credit notes net the outward supplies (per CBIC GSTR-3B return
   * instructions): the taxable value of a credit note reduces the
   * taxable value reported in 3.1(a) for the period it falls in.
   */
  async summariseForSeller(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<Gstr3bSummary> {
    const { startUtc, endUtc } = monthRangeUtc(args.filingPeriod);
    const docs = await this.prisma.taxDocument.findMany({
      where: {
        sellerId: args.sellerId,
        generatedAt: { gte: startUtc, lt: endUtc },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      include: { lines: true },
    });

    const agg = aggregateGstr1(docs);
    const section31 = buildSection31(agg);
    const section32 = buildSection32(agg);

    return {
      filingPeriod: args.filingPeriod,
      sellerId: args.sellerId,
      section31,
      section32,
    };
  }

  /**
   * Build the GSTR-3B CSV — single-section export covering 3.1.
   * Header is load-bearing for upload tooling.
   */
  async generateCsv(args: {
    sellerId: string;
    filingPeriod: string;
  }): Promise<string> {
    const summary = await this.summariseForSeller(args);
    const header =
      'Section,Description,Taxable Value,CGST,SGST,IGST,Cess';
    const rows = [
      [
        '3.1(a)',
        csvCell('Outward taxable supplies (other than zero/nil/exempt)'),
        paiseToRupees(summary.section31.outwardTaxableInPaise),
        paiseToRupees(summary.section31.cgstInPaise),
        paiseToRupees(summary.section31.sgstInPaise),
        paiseToRupees(summary.section31.igstInPaise),
        paiseToRupees(summary.section31.cessInPaise),
      ].join(','),
      [
        '3.1(b)',
        csvCell('Outward taxable supplies (zero-rated)'),
        paiseToRupees(summary.section31.outwardZeroRatedInPaise),
        '0.00',
        '0.00',
        '0.00',
        '0.00',
      ].join(','),
      [
        '3.1(c)',
        csvCell('Other outward supplies (nil-rated, exempted)'),
        paiseToRupees(summary.section31.otherOutwardInPaise),
        '0.00',
        '0.00',
        '0.00',
        '0.00',
      ].join(','),
      [
        '3.1(e)',
        csvCell('Non-GST outward supplies'),
        paiseToRupees(summary.section31.nonGstOutwardInPaise),
        '0.00',
        '0.00',
        '0.00',
        '0.00',
      ].join(','),
    ];
    return [header, ...rows].join('\n');
  }
}

function buildSection31(agg: Gstr1Aggregate): Gstr3bSection31 {
  // Section 3.1(a) = total taxable + tax from B2B/B2C minus CREDIT_NOTE
  // reversals (already netted in agg.totals — credit notes add to
  // totals.creditNoteValueInPaise but their taxable amounts also flow
  // through their own totals path. Cleaner to subtract explicitly.)
  let taxable = agg.totals.taxableInPaise;
  let cgst = agg.totals.cgstInPaise;
  let sgst = agg.totals.sgstInPaise;
  let igst = agg.totals.igstInPaise;
  let cess = agg.totals.cessInPaise;
  // Subtract credit-note reversals (they were already in agg.totals
  // because aggregateGstr1 currently sums TAX_INVOICE rows only into
  // totals; we still subtract here so future schema changes don't
  // double-count). The aggregator's contract is: totals.taxableInPaise
  // is the GROSS pre-credit-note total. Credit notes net it in 3B.
  for (const cn of agg.creditNotes) {
    taxable -= cn.taxableReversalInPaise;
    cgst -= cn.cgstReversalInPaise;
    sgst -= cn.sgstReversalInPaise;
    igst -= cn.igstReversalInPaise;
    cess -= cn.cessReversalInPaise;
  }
  // Clamp at zero per CBIC return-filing convention (a net-negative
  // outward supply isn't a valid 3B input; the excess carries forward
  // via the seller's own books).
  return {
    outwardTaxableInPaise: taxable < 0n ? 0n : taxable,
    outwardZeroRatedInPaise: 0n,
    otherOutwardInPaise: 0n,
    nonGstOutwardInPaise: 0n,
    cgstInPaise: cgst < 0n ? 0n : cgst,
    sgstInPaise: sgst < 0n ? 0n : sgst,
    igstInPaise: igst < 0n ? 0n : igst,
    cessInPaise: cess < 0n ? 0n : cess,
  };
}

function buildSection32(agg: Gstr1Aggregate): Gstr3bSection32Row[] {
  // 3.2 = inter-state B2C supplies (B2C Large + B2C Small inter-state)
  // by place of supply. Aggregated from the GSTR-1 B2C buckets.
  const map = new Map<string, Gstr3bSection32Row>();
  for (const r of agg.b2cLarge) {
    upsert32(map, r.placeOfSupplyStateCode, r.taxableInPaise, r.igstInPaise);
  }
  for (const r of agg.b2cSmall) {
    // Only inter-state B2C Small contributes to 3.2 — distinguished
    // by IGST > 0. Intra-state (CGST + SGST) is already in 3.1(a).
    if (r.igstInPaise > 0n) {
      upsert32(
        map,
        r.placeOfSupplyStateCode,
        r.taxableInPaise,
        r.igstInPaise,
      );
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

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function monthRangeUtc(filingPeriod: string): {
  startUtc: Date;
  endUtc: Date;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(filingPeriod);
  if (!match) {
    throw new Error(`Invalid filing period: ${filingPeriod} (want YYYY-MM)`);
  }
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const startUtc = new Date(Date.UTC(y, m - 1, 1) - 5.5 * 60 * 60 * 1000);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 0 : m;
  const endUtc = new Date(
    Date.UTC(nextY, nextM, 1) - 5.5 * 60 * 60 * 1000,
  );
  return { startUtc, endUtc };
}
