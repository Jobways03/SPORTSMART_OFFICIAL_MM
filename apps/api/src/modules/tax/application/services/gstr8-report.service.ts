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
// Phase 159z — audit remediation:
//   B1  Trade Name now populated from Seller.sellerShopName / sellerName
//       (was hard-coded empty for two phases).
//   #4  Per-place-of-supply emission: one CSV / JSON row per
//       (supplier, place-of-supply) using the breakdown stored on
//       the ledger at compute time (TcsService).
//   #7  Schema-versioned headers — current = 2024-Q3 CBIC layout.
//       Older templates remain selectable for re-export of old returns.
//   #8  Streaming CSV — controller calls streamCsv(res, …) so a
//       50k-seller period doesn't buffer 40MB in memory.
//
// See:
//   - docs/tax/TCS_POLICY.md §7 (export format)

import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { escapeCsvField } from '../../../../core/utils/csv.util';
import {
  type GstTcsSettlementLedgerWithSeller,
  type PlaceOfSupplyBreakdownEntry,
  TcsService,
} from './tcs.service';
import { PlaceOfSupplyService } from './place-of-supply.service';

export interface Gstr8CsvRow {
  gstinOfSupplier: string;
  tradeName: string;
  placeOfSupply: string;
  grossTaxableSupplyInRupees: string;
  creditNoteReversalInRupees: string;
  netTaxableSupplyInRupees: string;
  cgstTcsInRupees: string;
  sgstTcsInRupees: string;
  igstTcsInRupees: string;
  totalTcsInRupees: string;
  filingPeriod: string;
}

export interface Gstr8JsonDetailEntry {
  gstin: string;
  trade_name: string;
  pos: string; // 2-digit place-of-supply state code
  pos_name: string;
  gross_supply_in_paise: string;
  credit_note_reversal_in_paise: string;
  net_taxable_supply_in_paise: string;
  cgst_tcs_in_paise: string;
  sgst_tcs_in_paise: string;
  igst_tcs_in_paise: string;
  total_tcs_in_paise: string;
}

export interface Gstr8JsonPayload {
  gstin: string; // Sportsmart's operator GSTIN
  ret_period: string; // "MMYYYY" per CBIC convention
  schema_version: string; // Phase 159z (audit #7) — pinned for forward-compat.
  tot_supp_in_paise: string; // BigInt → string
  tot_tcs_in_paise: string;
  details: Gstr8JsonDetailEntry[];
}

/**
 * Phase 159z (audit #7) — CBIC GSTR-8 CSV column layouts. Versioning
 * is keyed by the CBIC effective quarter (the year-quarter the layout
 * was published). The exporter defaults to `current` so freshly-cut
 * filings always use the latest layout; callers can pin an older
 * version to re-emit a historical return in its contemporary format.
 *
 * `current` is updated together with `CURRENT_SCHEMA_VERSION` whenever
 * CBIC publishes a new layout (governance: docs/tax/TCS_POLICY.md §11).
 */
export const GSTR8_SCHEMA_VERSIONS = {
  '2024-Q3': [
    'GSTIN of Supplier',
    'Trade Name',
    'Place of Supply',
    'Gross Supply Value',
    'Credit Note Reversal',
    'Net Taxable Supply',
    'CGST TCS',
    'SGST TCS',
    'IGST TCS',
    'Total TCS',
    'Filing Period',
  ],
} as const;

export type Gstr8SchemaVersion = keyof typeof GSTR8_SCHEMA_VERSIONS;
export const CURRENT_GSTR8_SCHEMA_VERSION: Gstr8SchemaVersion = '2024-Q3';

@Injectable()
export class Gstr8ReportService {
  private readonly logger = new Logger(Gstr8ReportService.name);

  constructor(
    private readonly tcs: TcsService,
    private readonly placeOfSupply: PlaceOfSupplyService,
  ) {}

  /**
   * Resolve the header for a requested schema version. Unknown versions
   * fall back to current with a logged warning so older clients keep
   * working but the operator notices the drift.
   */
  private headerFor(schemaVersion?: string): readonly string[] {
    const key = (schemaVersion ?? CURRENT_GSTR8_SCHEMA_VERSION) as Gstr8SchemaVersion;
    const headers = GSTR8_SCHEMA_VERSIONS[key];
    if (!headers) {
      this.logger.warn(
        `Unknown GSTR-8 schema version "${schemaVersion}"; falling back to ` +
          `current ${CURRENT_GSTR8_SCHEMA_VERSION}`,
      );
      return GSTR8_SCHEMA_VERSIONS[CURRENT_GSTR8_SCHEMA_VERSION];
    }
    return headers;
  }

  /**
   * Build the CSV body. Returns the full file contents as a string —
   * preserved for tests + tiny periods. Production callers prefer
   * `streamCsv(res, …)` which avoids buffering the full body.
   */
  async generateCsv(
    filingPeriod: string,
    opts: { schemaVersion?: string } = {},
  ): Promise<string> {
    const headers = this.headerFor(opts.schemaVersion);
    const lines = [headers.join(',')];
    const rows = await this.tcs.listForPeriod(filingPeriod);
    const codeToName = await this.placeOfSupply.getStateCodeToNameMap();
    for (const ledger of rows) {
      for (const detail of expandLedgerToBreakdown(ledger, codeToName)) {
        lines.push(emitCsvRow(ledger, detail, filingPeriod).join(','));
      }
    }
    return lines.join('\n');
  }

  /**
   * Phase 159z (audit #8) — streaming variant for production
   * downloads. Writes the header line, then each (supplier, PoS) row
   * as soon as it is available. Holds at most one batch in memory.
   */
  async streamCsv(
    res: Response,
    filingPeriod: string,
    opts: { schemaVersion?: string } = {},
  ): Promise<{ rowsEmitted: number; bytesWritten: number }> {
    const headers = this.headerFor(opts.schemaVersion);
    const codeToName = await this.placeOfSupply.getStateCodeToNameMap();
    let bytesWritten = 0;
    let rowsEmitted = 0;
    const writeLine = (line: string): void => {
      const payload = `${line}\n`;
      res.write(payload);
      bytesWritten += Buffer.byteLength(payload, 'utf8');
    };
    writeLine(headers.join(','));
    for await (const ledger of this.tcs.streamForPeriod(filingPeriod)) {
      for (const detail of expandLedgerToBreakdown(ledger, codeToName)) {
        writeLine(emitCsvRow(ledger, detail, filingPeriod).join(','));
        rowsEmitted++;
      }
    }
    res.end();
    return { rowsEmitted, bytesWritten };
  }

  /**
   * Build the NIC JSON payload shape. Schema fields are ready; the
   * NIC submission envelope (authentication header + chunk encoding)
   * is intentionally not wired here — Phase 22 covers integration.
   *
   * Phase 159z (audit B1 + #4 + B3) — emits one detail entry per
   * (supplier, place-of-supply). Trade name is populated from the
   * seller. operatorGstin is sourced server-side by the controller.
   */
  async generateJsonPayload(
    filingPeriod: string,
    operatorGstin: string,
    opts: { schemaVersion?: string } = {},
  ): Promise<Gstr8JsonPayload> {
    const rows = await this.tcs.listForPeriod(filingPeriod);
    const codeToName = await this.placeOfSupply.getStateCodeToNameMap();

    let totSupply = 0n;
    let totTcs = 0n;
    const details: Gstr8JsonDetailEntry[] = [];
    for (const ledger of rows) {
      const tradeName = resolveTradeName(ledger);
      for (const detail of expandLedgerToBreakdown(ledger, codeToName)) {
        const grossInPaise = BigInt(detail.grossInPaise);
        const totalTcsInPaise = BigInt(detail.totalTcsInPaise);
        totSupply += grossInPaise;
        totTcs += totalTcsInPaise;
        details.push({
          gstin: ledger.supplierGstin ?? '',
          trade_name: tradeName,
          pos: detail.pos,
          pos_name: detail.posName,
          gross_supply_in_paise: detail.grossInPaise,
          credit_note_reversal_in_paise: detail.creditNoteReversalInPaise,
          net_taxable_supply_in_paise: detail.netTaxableInPaise,
          cgst_tcs_in_paise: detail.cgstTcsInPaise,
          sgst_tcs_in_paise: detail.sgstTcsInPaise,
          igst_tcs_in_paise: detail.igstTcsInPaise,
          total_tcs_in_paise: detail.totalTcsInPaise,
        });
      }
    }

    return {
      gstin: operatorGstin,
      ret_period: toRetPeriod(filingPeriod),
      schema_version: (opts.schemaVersion as Gstr8SchemaVersion) ?? CURRENT_GSTR8_SCHEMA_VERSION,
      tot_supp_in_paise: totSupply.toString(),
      tot_tcs_in_paise: totTcs.toString(),
      details,
    };
  }

  /**
   * Period-level summary for the admin UI ("Filing period 2026-04:
   * 47 sellers, ₹12.4L net supply, ₹12,400 total TCS").
   *
   * Phase 159z (audit #14) — paginated. The UI fetches one page at a
   * time; the totals are computed across the WHOLE period in a single
   * aggregate query so the displayed numbers remain honest.
   */
  async summarise(args: {
    filingPeriod: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    filingPeriod: string;
    sellerCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
    totalGrossInPaise: bigint;
    totalCreditNoteReversalInPaise: bigint;
    totalNetTaxableInPaise: bigint;
    totalCgstTcsInPaise: bigint;
    totalSgstTcsInPaise: bigint;
    totalIgstTcsInPaise: bigint;
    totalTcsInPaise: bigint;
    rows: GstTcsSettlementLedgerWithSeller[];
  }> {
    const page = args.page && args.page > 0 ? args.page : 1;
    const pageSize =
      args.pageSize && args.pageSize > 0
        ? Math.min(500, args.pageSize)
        : 50;
    const paged = await this.tcs.listForPeriodPaginated({
      filingPeriod: args.filingPeriod,
      page,
      pageSize,
    });
    return {
      filingPeriod: args.filingPeriod,
      sellerCount: paged.totalRows,
      page: paged.page,
      pageSize: paged.pageSize,
      totalPages: paged.totalPages,
      totalGrossInPaise: paged.totals.grossTaxableSupplyInPaise,
      totalCreditNoteReversalInPaise: paged.totals.creditNoteReversalInPaise,
      totalNetTaxableInPaise: paged.totals.netTaxableSupplyInPaise,
      totalCgstTcsInPaise: paged.totals.cgstTcsInPaise,
      totalSgstTcsInPaise: paged.totals.sgstTcsInPaise,
      totalIgstTcsInPaise: paged.totals.igstTcsInPaise,
      totalTcsInPaise: paged.totals.totalTcsInPaise,
      rows: paged.rows,
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

// Phase 159x (audit B1) — delegate to the shared core helper (RFC-4180 +
// CWE-1236 formula-injection guard). See gstr1-report.service.ts.
function csvCell(value: string): string {
  return escapeCsvField(value);
}

/** "2026-04" → "042026" per CBIC MMYYYY convention. */
function toRetPeriod(filingPeriod: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(filingPeriod);
  if (!m) return filingPeriod;
  return `${m[2]}${m[1]}`;
}

/**
 * Phase 159z (audit B1) — derive the supplier trade name from the
 * seller relation. Prefers `sellerShopName` (the public-facing brand)
 * over `sellerName` (the registered legal name) per CBIC's "trade
 * name" definition. Falls back to empty when the seller record is
 * absent (e.g. platform-direct rows — currently excluded by policy).
 */
function resolveTradeName(
  ledger: GstTcsSettlementLedgerWithSeller,
): string {
  if (!ledger.seller) return '';
  const shop = ledger.seller.sellerShopName?.trim();
  const legal = ledger.seller.sellerName?.trim();
  return shop || legal || '';
}

/**
 * Phase 159z (audit #4) — flatten the rolled-up ledger row into one
 * breakdown entry per place-of-supply state code. The breakdown JSON
 * column is the source of truth; when it's empty (older rows written
 * before this column existed), we synthesise a single "Unknown" entry
 * from the rolled totals so historical exports still emit a row.
 */
function expandLedgerToBreakdown(
  ledger: GstTcsSettlementLedgerWithSeller,
  codeToName: ReadonlyMap<string, string>,
): PlaceOfSupplyBreakdownEntry[] {
  const raw = ledger.placeOfSupplyBreakdownJson as unknown;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw as PlaceOfSupplyBreakdownEntry[];
  }
  // Legacy / pre-Phase-159z row — synthesise a single entry from the
  // rolled totals so we never silently drop a ledger row.
  const pos = ledger.supplierStateCode ?? 'UNK';
  return [
    {
      pos,
      posName: codeToName.get(pos) ?? (pos === 'UNK' ? 'Unknown' : pos),
      grossInPaise: ledger.grossTaxableSupplyInPaise.toString(),
      creditNoteReversalInPaise: ledger.creditNoteReversalInPaise.toString(),
      netTaxableInPaise: ledger.netTaxableSupplyInPaise.toString(),
      cgstTcsInPaise: ledger.cgstTcsInPaise.toString(),
      sgstTcsInPaise: ledger.sgstTcsInPaise.toString(),
      igstTcsInPaise: ledger.igstTcsInPaise.toString(),
      totalTcsInPaise: ledger.totalTcsInPaise.toString(),
    },
  ];
}

/**
 * Phase 159z (audit B1 + B2 + #4) — single CSV row emit shared by the
 * buffered `generateCsv` and the streaming variant. Every text cell
 * goes through `escapeCsvField` so a malicious shop-name (e.g.
 * `=cmd|'/c calc'!A1`) cannot be interpreted as a formula by Excel.
 */
function emitCsvRow(
  ledger: GstTcsSettlementLedgerWithSeller,
  detail: PlaceOfSupplyBreakdownEntry,
  filingPeriod: string,
): string[] {
  return [
    csvCell(ledger.supplierGstin ?? ''),
    csvCell(resolveTradeName(ledger)),
    csvCell(detail.posName),
    paiseToRupees(BigInt(detail.grossInPaise)),
    paiseToRupees(BigInt(detail.creditNoteReversalInPaise)),
    paiseToRupees(BigInt(detail.netTaxableInPaise)),
    paiseToRupees(BigInt(detail.cgstTcsInPaise)),
    paiseToRupees(BigInt(detail.sgstTcsInPaise)),
    paiseToRupees(BigInt(detail.igstTcsInPaise)),
    paiseToRupees(BigInt(detail.totalTcsInPaise)),
    csvCell(filingPeriod),
  ];
}
