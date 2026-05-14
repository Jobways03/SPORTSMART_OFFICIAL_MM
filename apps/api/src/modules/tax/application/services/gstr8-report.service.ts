// Phase 16 GST — Gstr8ReportService.
//
// Builds the GSTR-8 export shapes from the TCS settlement ledger:
//   - CSV (per CBIC's "Form GSTR-8" schema — operator-side details).
//   - JSON payload (NIC e-portal upload — schema fields ready; the
//     conversion to the NIC submission envelope stays a stub until
//     CA confirms the NIC integration timing).
//
// Both shapes filter to non-REVERSED rows + the requested filing
// period. Empty periods produce a header-only CSV (NIL filing) and
// an empty JSON `details` array — GSTR-8 NIL filing is typically
// required even in months with zero TCS.
//
// See:
//   - docs/tax/TCS_POLICY.md §7 (export format)

import { Injectable, Logger } from '@nestjs/common';
import type { GstTcsSettlementLedger } from '@prisma/client';
import { TcsService } from './tcs.service';

export interface Gstr8CsvRow {
  gstinOfSupplier: string;
  tradeName: string;
  grossTaxableSupplyInRupees: string;
  creditNoteReversalInRupees: string;
  netTaxableSupplyInRupees: string;
  cgstTcsInRupees: string;
  sgstTcsInRupees: string;
  igstTcsInRupees: string;
  totalTcsInRupees: string;
  filingPeriod: string;
}

export interface Gstr8JsonPayload {
  gstin: string;             // Sportsmart's operator GSTIN
  ret_period: string;        // "MMYYYY" per CBIC convention
  tot_supp_in_paise: string; // BigInt → string
  tot_tcs_in_paise: string;
  details: Array<{
    gstin: string;
    trade_name: string;
    gross_supply_in_paise: string;
    credit_note_reversal_in_paise: string;
    net_taxable_supply_in_paise: string;
    cgst_tcs_in_paise: string;
    sgst_tcs_in_paise: string;
    igst_tcs_in_paise: string;
    total_tcs_in_paise: string;
  }>;
}

@Injectable()
export class Gstr8ReportService {
  private readonly logger = new Logger(Gstr8ReportService.name);

  // CBIC GSTR-8 CSV header — order is load-bearing for upload tooling.
  // CA can confirm against the current template (TCS_POLICY §11 item 5).
  private static readonly CSV_HEADER = [
    'GSTIN of Supplier',
    'Trade Name',
    'Gross Supply Value',
    'Credit Note Reversal',
    'Net Taxable Supply',
    'CGST TCS',
    'SGST TCS',
    'IGST TCS',
    'Total TCS',
    'Filing Period',
  ];

  constructor(private readonly tcs: TcsService) {}

  /**
   * Build the CSV body. Returns the full file contents as a string
   * (caller writes to disk / streams to HTTP). Empty periods produce
   * a header-only file (NIL filing).
   */
  async generateCsv(filingPeriod: string): Promise<string> {
    const rows = await this.tcs.listForPeriod(filingPeriod);
    const lines = [Gstr8ReportService.CSV_HEADER.join(',')];
    for (const r of rows) {
      const cells = [
        csvCell(r.supplierGstin ?? ''),
        csvCell(''), // Trade name — Phase 18 enriches via Seller.shopName.
        paiseToRupees(r.grossTaxableSupplyInPaise),
        paiseToRupees(r.creditNoteReversalInPaise),
        paiseToRupees(r.netTaxableSupplyInPaise),
        paiseToRupees(r.cgstTcsInPaise),
        paiseToRupees(r.sgstTcsInPaise),
        paiseToRupees(r.igstTcsInPaise),
        paiseToRupees(r.totalTcsInPaise),
        csvCell(r.filingPeriod),
      ];
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }

  /**
   * Build the NIC JSON payload shape. Schema fields are ready; the
   * NIC submission envelope (authentication header + chunk encoding)
   * is intentionally not wired here — Phase 22 covers integration.
   */
  async generateJsonPayload(
    filingPeriod: string,
    operatorGstin: string,
  ): Promise<Gstr8JsonPayload> {
    const rows = await this.tcs.listForPeriod(filingPeriod);

    let totSupply = 0n;
    let totTcs = 0n;
    const details = rows.map((r) => {
      totSupply += r.grossTaxableSupplyInPaise;
      totTcs += r.totalTcsInPaise;
      return {
        gstin: r.supplierGstin ?? '',
        trade_name: '',
        gross_supply_in_paise: r.grossTaxableSupplyInPaise.toString(),
        credit_note_reversal_in_paise: r.creditNoteReversalInPaise.toString(),
        net_taxable_supply_in_paise: r.netTaxableSupplyInPaise.toString(),
        cgst_tcs_in_paise: r.cgstTcsInPaise.toString(),
        sgst_tcs_in_paise: r.sgstTcsInPaise.toString(),
        igst_tcs_in_paise: r.igstTcsInPaise.toString(),
        total_tcs_in_paise: r.totalTcsInPaise.toString(),
      };
    });

    return {
      gstin: operatorGstin,
      ret_period: toRetPeriod(filingPeriod),
      tot_supp_in_paise: totSupply.toString(),
      tot_tcs_in_paise: totTcs.toString(),
      details,
    };
  }

  /**
   * Period-level summary for the admin UI ("Filing period 2026-04:
   * 47 sellers, ₹12.4L net supply, ₹12,400 total TCS").
   */
  async summarise(filingPeriod: string): Promise<{
    filingPeriod: string;
    sellerCount: number;
    totalGrossInPaise: bigint;
    totalCreditNoteReversalInPaise: bigint;
    totalNetTaxableInPaise: bigint;
    totalCgstTcsInPaise: bigint;
    totalSgstTcsInPaise: bigint;
    totalIgstTcsInPaise: bigint;
    totalTcsInPaise: bigint;
    rows: GstTcsSettlementLedger[];
  }> {
    const rows = await this.tcs.listForPeriod(filingPeriod);
    const summary = rows.reduce(
      (acc, r) => ({
        totalGrossInPaise: acc.totalGrossInPaise + r.grossTaxableSupplyInPaise,
        totalCreditNoteReversalInPaise:
          acc.totalCreditNoteReversalInPaise + r.creditNoteReversalInPaise,
        totalNetTaxableInPaise:
          acc.totalNetTaxableInPaise + r.netTaxableSupplyInPaise,
        totalCgstTcsInPaise: acc.totalCgstTcsInPaise + r.cgstTcsInPaise,
        totalSgstTcsInPaise: acc.totalSgstTcsInPaise + r.sgstTcsInPaise,
        totalIgstTcsInPaise: acc.totalIgstTcsInPaise + r.igstTcsInPaise,
        totalTcsInPaise: acc.totalTcsInPaise + r.totalTcsInPaise,
      }),
      {
        totalGrossInPaise: 0n,
        totalCreditNoteReversalInPaise: 0n,
        totalNetTaxableInPaise: 0n,
        totalCgstTcsInPaise: 0n,
        totalSgstTcsInPaise: 0n,
        totalIgstTcsInPaise: 0n,
        totalTcsInPaise: 0n,
      },
    );
    return {
      filingPeriod,
      sellerCount: rows.length,
      ...summary,
      rows,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function paiseToRupees(p: bigint): string {
  // "12345" paise → "123.45". Sign-preserving. Avoids floating-point.
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const cellRupees = `${whole.toString()}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${cellRupees}` : cellRupees;
}

function csvCell(value: string): string {
  // Wrap in quotes when value contains comma, quote, or newline. Escape
  // embedded quotes by doubling.
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** "2026-04" → "042026" per CBIC MMYYYY convention. */
function toRetPeriod(filingPeriod: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(filingPeriod);
  if (!m) return filingPeriod;
  return `${m[2]}${m[1]}`;
}
