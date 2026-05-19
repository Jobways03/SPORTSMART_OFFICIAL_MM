// Phase 28+ — Marketplace commission GSTR-1 export.
//
// The marketplace's commission to a seller is a B2B service supply
// (SAC 9985) the platform must declare on ITS OWN GSTR-1 outward
// supplies — separate from the per-seller GSTR-1 the platform also
// generates on behalf of sellers for their PRODUCT sales.
//
// Aggregates SellerSettlement rows in a given filing period (monthly
// "YYYY-MM" mapped onto cycle.periodEnd in IST) by seller, summing:
//   - totalPlatformMargin (commission base)
//   - cgst/sgst/igst on commission
//   - taxSplit (CGST_SGST vs IGST)
//
// One CSV row per (seller, period). Maps to GSTR-1 §4 B2B outward
// supplies under SAC 9985 / 18% rate.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

export interface MarketplaceCommissionGstrRow {
  /** Seller's GSTIN — receiver of the commission service. */
  recipientGstin: string;
  /** Seller's legal name (frozen at compute time on the row). */
  recipientLegalName: string;
  recipientStateCode: string;
  /** Taxable value = commission charged in the period (rupees). */
  commissionInRupees: string;
  cgstInRupees: string;
  sgstInRupees: string;
  igstInRupees: string;
  totalGstInRupees: string;
  taxSplit: 'CGST_SGST' | 'IGST';
  /** Always 18% for commission service today; carried for audit clarity. */
  rateBps: number;
  /** Number of constituent SellerSettlement rows that contributed. */
  settlementCount: number;
}

@Injectable()
export class MarketplaceCommissionGstrService {
  private readonly logger = new Logger(MarketplaceCommissionGstrService.name);

  // GSTR-1 §4 B2B-style header. Maps cleanly onto the CBIC schema
  // when ops uploads via the GSTN portal; column names are explicit
  // (not abbreviated) so a non-technical reviewer can grok them.
  private static readonly CSV_HEADER = [
    'Recipient GSTIN',
    'Recipient Legal Name',
    'Recipient State Code',
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
  ];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the per-seller commission aggregation for a filing period.
   * Empty periods (no commission billed) return an empty array; the
   * caller emits a header-only CSV (NIL filing).
   */
  async aggregateForPeriod(
    filingPeriod: string,
  ): Promise<MarketplaceCommissionGstrRow[]> {
    const { startUtc, endUtc } = monthRangeUtc(filingPeriod);

    // Pull all SellerSettlement rows whose cycle's periodEnd falls
    // inside the IST month. We rely on the Phase 28 denorm columns
    // (totalCommissionGstInPaise etc) being populated; legacy rows
    // before that work return zero contributions.
    const settlements = await (this.prisma as any).sellerSettlement.findMany(
      {
        where: {
          cycle: { periodEnd: { gte: startUtc, lt: endUtc } },
        },
        include: {
          seller: {
            select: {
              gstin: true,
              legalBusinessName: true,
              sellerShopName: true,
              gstStateCode: true,
            },
          },
        },
      },
    );

    // Group by sellerId. Each seller contributes one CSV row even
    // when they have multiple settlement cycles in the same month
    // (e.g. weekly cycles).
    const buckets = new Map<
      string,
      {
        recipientGstin: string;
        recipientLegalName: string;
        recipientStateCode: string;
        commissionInPaise: bigint;
        cgstInPaise: bigint;
        sgstInPaise: bigint;
        igstInPaise: bigint;
        totalGstInPaise: bigint;
        rateBps: number;
        taxSplit: 'CGST_SGST' | 'IGST';
        settlementCount: number;
      }
    >();

    for (const s of settlements as Array<Record<string, any>>) {
      const sellerId = s.sellerId as string;
      const sellerInfo = s.seller as Record<string, any> | undefined;
      const gstin = (sellerInfo?.gstin as string | null) ?? '';
      // Skip rows whose seller doesn't have a GSTIN registered —
      // commission to non-GSTIN sellers can't be reported on GSTR-1
      // §4 B2B (would go under §7 B2C or be exempt depending on
      // CA policy). Add an explicit ops queue for these later.
      if (!gstin) continue;

      const legalName =
        (sellerInfo?.legalBusinessName as string | null) ??
        (sellerInfo?.sellerShopName as string | null) ??
        sellerId.slice(0, 8);
      const stateCode = (sellerInfo?.gstStateCode as string | null) ?? '';
      const commission = BigInt(
        Math.round(Number(s.totalPlatformAmount || 0) * 0) +
          // totalPlatformMargin is Decimal; we use the in-paise
          // sibling when present, else round-trip via Math.round.
          (typeof s.totalPlatformMarginInPaise === 'bigint'
            ? Number(s.totalPlatformMarginInPaise.toString())
            : Math.round(Number(s.totalPlatformMargin || 0) * 100)),
      );
      const cgst =
        s.cgstOnCommissionInPaise != null
          ? BigInt(s.cgstOnCommissionInPaise)
          : 0n;
      const sgst =
        s.sgstOnCommissionInPaise != null
          ? BigInt(s.sgstOnCommissionInPaise)
          : 0n;
      const igst =
        s.igstOnCommissionInPaise != null
          ? BigInt(s.igstOnCommissionInPaise)
          : 0n;
      const total =
        s.totalCommissionGstInPaise != null
          ? BigInt(s.totalCommissionGstInPaise)
          : 0n;
      const rateBps =
        typeof s.commissionGstRateBps === 'number'
          ? s.commissionGstRateBps
          : 1800;
      const split: 'CGST_SGST' | 'IGST' =
        s.commissionGstSplitType === 'CGST_SGST' ? 'CGST_SGST' : 'IGST';

      const existing = buckets.get(sellerId);
      if (existing) {
        existing.commissionInPaise += commission;
        existing.cgstInPaise += cgst;
        existing.sgstInPaise += sgst;
        existing.igstInPaise += igst;
        existing.totalGstInPaise += total;
        existing.settlementCount += 1;
        // Tax-split mismatch across cycles is rare but conceivable
        // (a seller's GSTIN changes state mid-period). Use the
        // dominant — IGST wins to be conservative for the report.
        if (existing.taxSplit !== split) existing.taxSplit = 'IGST';
      } else {
        buckets.set(sellerId, {
          recipientGstin: gstin,
          recipientLegalName: legalName,
          recipientStateCode: stateCode,
          commissionInPaise: commission,
          cgstInPaise: cgst,
          sgstInPaise: sgst,
          igstInPaise: igst,
          totalGstInPaise: total,
          rateBps,
          taxSplit: split,
          settlementCount: 1,
        });
      }
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.recipientGstin.localeCompare(b.recipientGstin))
      .map((b) => ({
        recipientGstin: b.recipientGstin,
        recipientLegalName: b.recipientLegalName,
        recipientStateCode: b.recipientStateCode,
        commissionInRupees: paiseToRupees(b.commissionInPaise),
        cgstInRupees: paiseToRupees(b.cgstInPaise),
        sgstInRupees: paiseToRupees(b.sgstInPaise),
        igstInRupees: paiseToRupees(b.igstInPaise),
        totalGstInRupees: paiseToRupees(b.totalGstInPaise),
        taxSplit: b.taxSplit,
        rateBps: b.rateBps,
        settlementCount: b.settlementCount,
      }));
  }

  async generateCsv(filingPeriod: string): Promise<string> {
    const rows = await this.aggregateForPeriod(filingPeriod);
    const lines = [MarketplaceCommissionGstrService.CSV_HEADER.join(',')];
    for (const r of rows) {
      lines.push(
        [
          csvCell(r.recipientGstin),
          csvCell(r.recipientLegalName),
          csvCell(r.recipientStateCode),
          csvCell(filingPeriod),
          '9985',
          (r.rateBps / 100).toFixed(2),
          r.commissionInRupees,
          r.cgstInRupees,
          r.sgstInRupees,
          r.igstInRupees,
          r.totalGstInRupees,
          csvCell(r.taxSplit),
          r.settlementCount.toString(),
        ].join(','),
      );
    }
    return lines.join('\n');
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function csvCell(value: string): string {
  if (value === '') return '';
  if (/[,"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function paiseToRupees(p: bigint): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const rupees = `${whole.toString()}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${rupees}` : rupees;
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
    Date.UTC(y, month - 1, 1, 0, 0, 0) - 5.5 * 60 * 60 * 1000,
  );
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? y + 1 : y;
  const endUtc = new Date(
    Date.UTC(endYear, endMonth - 1, 1, 0, 0, 0) - 5.5 * 60 * 60 * 1000,
  );
  return { startUtc, endUtc };
}
