import 'reflect-metadata';
import {
  CURRENT_GSTR8_SCHEMA_VERSION,
  GSTR8_SCHEMA_VERSIONS,
  Gstr8ReportService,
} from '../../src/modules/tax/application/services/gstr8-report.service';

// Phase 16 GST — Gstr8ReportService tests.
//
// Covers CSV / JSON output shapes + period-level summary. TcsService
// and PlaceOfSupplyService are stubbed via narrow mocks — the calc
// pipeline itself is exercised in tax-tcs-calculator + tax-tcs-service.
//
// Phase 159z (GSTR-8 audit remediation):
//   - Trade Name + Place of Supply columns are now populated.
//   - Per-place-of-supply breakdown is iterated to emit one CSV / JSON
//     row per (supplier, PoS) — the CBIC-format row structure.
//   - Schema versioning, streaming CSV variant, paginated summary.

interface MockTcs {
  listForPeriod: jest.Mock;
  listForPeriodPaginated: jest.Mock;
  streamForPeriod: jest.Mock;
  // Phase 160 (§52 lifecycle audit B1 / #13) — summarise now also fetches
  // status counts + period warnings.
  getPeriodStatusCounts: jest.Mock;
  getPeriodComputeWarnings: jest.Mock;
}

function placeOfSupplyStub(codeToName: Map<string, string> = new Map()) {
  return {
    getStateCodeToNameMap: jest.fn().mockResolvedValue(codeToName),
  };
}

function makeService(
  rows: any[] = [],
  codeToName: Map<string, string> = new Map([
    ['29', 'Karnataka'],
    ['07', 'Delhi'],
    ['27', 'Maharashtra'],
  ]),
): Gstr8ReportService {
  const tcs: MockTcs = {
    listForPeriod: jest.fn().mockResolvedValue(rows),
    listForPeriodPaginated: jest.fn().mockResolvedValue({
      rows,
      totalRows: rows.length,
      totalPages: 1,
      page: 1,
      pageSize: 50,
      totals: {
        grossTaxableSupplyInPaise: rows.reduce(
          (a: bigint, r: any) => a + (r.grossTaxableSupplyInPaise ?? 0n),
          0n,
        ),
        creditNoteReversalInPaise: rows.reduce(
          (a: bigint, r: any) => a + (r.creditNoteReversalInPaise ?? 0n),
          0n,
        ),
        netTaxableSupplyInPaise: rows.reduce(
          (a: bigint, r: any) => a + (r.netTaxableSupplyInPaise ?? 0n),
          0n,
        ),
        cgstTcsInPaise: rows.reduce(
          (a: bigint, r: any) => a + (r.cgstTcsInPaise ?? 0n),
          0n,
        ),
        sgstTcsInPaise: rows.reduce(
          (a: bigint, r: any) => a + (r.sgstTcsInPaise ?? 0n),
          0n,
        ),
        igstTcsInPaise: rows.reduce(
          (a: bigint, r: any) => a + (r.igstTcsInPaise ?? 0n),
          0n,
        ),
        totalTcsInPaise: rows.reduce(
          (a: bigint, r: any) => a + (r.totalTcsInPaise ?? 0n),
          0n,
        ),
        adjustmentCarriedForwardInPaise: rows.reduce(
          (a: bigint, r: any) => a + (r.adjustmentCarriedForwardInPaise ?? 0n),
          0n,
        ),
      },
    }),
    streamForPeriod: jest.fn().mockImplementation(async function* () {
      for (const r of rows) yield r;
    }),
    getPeriodStatusCounts: jest.fn().mockResolvedValue({
      COMPUTED: 0,
      COLLECTED: 0,
      FILED: 0,
      PAID_TO_GOVT: 0,
      CERTIFICATE_ISSUED: 0,
      REVERSED: 0,
    }),
    getPeriodComputeWarnings: jest
      .fn()
      .mockResolvedValue({ rateVariance: null, carryForward: null }),
  };
  const placeOfSupply = placeOfSupplyStub(codeToName);
  return new Gstr8ReportService(tcs as any, placeOfSupply as any);
}

const SAMPLE_LEDGER_INTRA = {
  id: 'l-1',
  supplierGstin: '29ABCDE1234F1Z5',
  supplierStateCode: '29',
  grossTaxableSupplyInPaise: 1_000_000n,
  creditNoteReversalInPaise: 200_000n,
  netTaxableSupplyInPaise: 800_000n,
  cgstTcsInPaise: 4_000n,
  sgstTcsInPaise: 4_000n,
  igstTcsInPaise: 0n,
  totalTcsInPaise: 8_000n,
  filingPeriod: '2026-04',
  placeOfSupplyBreakdownJson: [
    {
      pos: '29',
      posName: 'Karnataka',
      grossInPaise: '1000000',
      creditNoteReversalInPaise: '200000',
      netTaxableInPaise: '800000',
      cgstTcsInPaise: '4000',
      sgstTcsInPaise: '4000',
      igstTcsInPaise: '0',
      totalTcsInPaise: '8000',
    },
  ],
  seller: {
    id: 's-1',
    sellerName: 'Acme Sports Pvt Ltd',
    sellerShopName: 'Acme Sports',
  },
};

describe('Gstr8ReportService.generateCsv', () => {
  it('produces header-only CSV for empty periods (NIL filing)', async () => {
    const svc = makeService([]);
    const csv = await svc.generateCsv('2026-04');
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(GSTR8_SCHEMA_VERSIONS['2024-Q3'].join(','));
  });

  // Phase 159z (audit B1) — trade name is populated from sellerShopName.
  it('populates the Trade Name column from the seller relation', async () => {
    const svc = makeService([SAMPLE_LEDGER_INTRA]);
    const csv = await svc.generateCsv('2026-04');
    const data = csv.split('\n')[1].split(',');
    expect(data[1]).toBe('Acme Sports');
  });

  // Phase 159z (audit B2) — defence in depth. The shared escapeCsvField
  // helper already covers gstr8 (Phase 159x), but a malicious shop name
  // must still be neutralised post-B1 (which populated the column).
  it('neutralises formula-injection in the shop name', async () => {
    const svc = makeService([
      {
        ...SAMPLE_LEDGER_INTRA,
        seller: {
          id: 's-2',
          sellerName: 'Acme',
          sellerShopName: "=cmd|'/c calc'!A1",
        },
      },
    ]);
    const csv = await svc.generateCsv('2026-04');
    const dataLine = csv.split('\n')[1];
    const cells = dataLine.split(',');
    // Cell index 1 = trade name. The CWE-1236 guard prefixes a single
    // quote so the cell is no longer interpreted as a formula by Excel
    // / Google Sheets.
    expect(cells[1]).toBe("'=cmd|'/c calc'!A1");
    expect(cells[1]?.startsWith("'")).toBe(true);
    // No raw `=cmd` start-of-line in the body anywhere.
    expect(csv).not.toMatch(/^=cmd/m);
  });

  // Phase 159z (audit #4) — Place of Supply column populated from the
  // per-row breakdown (one CSV row per (supplier, PoS)).
  it('populates the Place of Supply column from the breakdown', async () => {
    const svc = makeService([SAMPLE_LEDGER_INTRA]);
    const csv = await svc.generateCsv('2026-04');
    const data = csv.split('\n')[1].split(',');
    expect(data[2]).toBe('Karnataka');
  });

  it('emits multiple CSV rows when a supplier sells to multiple PoS', async () => {
    const svc = makeService([
      {
        ...SAMPLE_LEDGER_INTRA,
        placeOfSupplyBreakdownJson: [
          {
            pos: '29',
            posName: 'Karnataka',
            grossInPaise: '600000',
            creditNoteReversalInPaise: '0',
            netTaxableInPaise: '600000',
            cgstTcsInPaise: '3000',
            sgstTcsInPaise: '3000',
            igstTcsInPaise: '0',
            totalTcsInPaise: '6000',
          },
          {
            pos: '07',
            posName: 'Delhi',
            grossInPaise: '400000',
            creditNoteReversalInPaise: '0',
            netTaxableInPaise: '400000',
            cgstTcsInPaise: '0',
            sgstTcsInPaise: '0',
            igstTcsInPaise: '4000',
            totalTcsInPaise: '4000',
          },
        ],
      },
    ]);
    const csv = await svc.generateCsv('2026-04');
    const lines = csv.split('\n');
    // Header + 2 PoS rows for this supplier.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Karnataka');
    expect(lines[2]).toContain('Delhi');
  });

  it('preserves header column order (load-bearing for upload tooling)', async () => {
    const svc = makeService([]);
    const csv = await svc.generateCsv('2026-04');
    const header = csv.split('\n')[0].split(',');
    expect(header).toEqual([
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
    ]);
  });

  it('falls back to legacy single-row emission when breakdown is empty', async () => {
    const svc = makeService([
      { ...SAMPLE_LEDGER_INTRA, placeOfSupplyBreakdownJson: [] },
    ]);
    const csv = await svc.generateCsv('2026-04');
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    // Place of Supply resolved from supplierStateCode='29' → Karnataka.
    expect(lines[1].split(',')[2]).toBe('Karnataka');
  });

  it('formats sub-rupee amounts correctly (paise padding)', async () => {
    const svc = makeService([
      {
        ...SAMPLE_LEDGER_INTRA,
        grossTaxableSupplyInPaise: 5n,
        creditNoteReversalInPaise: 0n,
        netTaxableSupplyInPaise: 5n,
        cgstTcsInPaise: 0n,
        sgstTcsInPaise: 0n,
        igstTcsInPaise: 0n,
        totalTcsInPaise: 0n,
        placeOfSupplyBreakdownJson: [
          {
            pos: '29',
            posName: 'Karnataka',
            grossInPaise: '5',
            creditNoteReversalInPaise: '0',
            netTaxableInPaise: '5',
            cgstTcsInPaise: '0',
            sgstTcsInPaise: '0',
            igstTcsInPaise: '0',
            totalTcsInPaise: '0',
          },
        ],
      },
    ]);
    const csv = await svc.generateCsv('2026-04');
    const data = csv.split('\n')[1].split(',');
    // Gross column index 3 in new header layout.
    expect(data[3]).toBe('0.05');
  });

  // Phase 159z (audit #7) — schema versioning. Unknown versions are
  // gated at the controller layer; the service silently falls back to
  // current and warns.
  it('falls back to current schema for unknown versions', async () => {
    const svc = makeService([]);
    const csv = await svc.generateCsv('2026-04', { schemaVersion: 'not-real' });
    const header = csv.split('\n')[0].split(',');
    expect(header).toEqual(GSTR8_SCHEMA_VERSIONS[CURRENT_GSTR8_SCHEMA_VERSION]);
  });
});

describe('Gstr8ReportService.generateJsonPayload', () => {
  it('produces empty details array on NIL period', async () => {
    const svc = makeService([]);
    const json = await svc.generateJsonPayload('2026-04', '29ABCDE1234F1Z5');
    expect(json.details).toEqual([]);
    expect(json.tot_supp_in_paise).toBe('0');
    expect(json.tot_tcs_in_paise).toBe('0');
    // Phase 159z — schema_version is pinned.
    expect(json.schema_version).toBe(CURRENT_GSTR8_SCHEMA_VERSION);
  });

  it('converts YYYY-MM to MMYYYY per CBIC convention', async () => {
    const svc = makeService([]);
    const json = await svc.generateJsonPayload('2026-04', '29ABCDE1234F1Z5');
    expect(json.ret_period).toBe('042026');
  });

  it('populates trade_name + pos in every detail entry', async () => {
    const svc = makeService([SAMPLE_LEDGER_INTRA]);
    const json = await svc.generateJsonPayload('2026-04', '29ABCDE1234F1Z5');
    expect(json.details).toHaveLength(1);
    expect(json.details[0].trade_name).toBe('Acme Sports');
    expect(json.details[0].pos).toBe('29');
    expect(json.details[0].pos_name).toBe('Karnataka');
    expect(json.details[0].gross_supply_in_paise).toBe('1000000');
    expect(json.details[0].total_tcs_in_paise).toBe('8000');
  });

  it('aggregates tot_supp + tot_tcs across PoS rows', async () => {
    const svc = makeService([
      {
        ...SAMPLE_LEDGER_INTRA,
        placeOfSupplyBreakdownJson: [
          {
            pos: '29',
            posName: 'Karnataka',
            grossInPaise: '600000',
            creditNoteReversalInPaise: '0',
            netTaxableInPaise: '600000',
            cgstTcsInPaise: '3000',
            sgstTcsInPaise: '3000',
            igstTcsInPaise: '0',
            totalTcsInPaise: '6000',
          },
          {
            pos: '07',
            posName: 'Delhi',
            grossInPaise: '400000',
            creditNoteReversalInPaise: '0',
            netTaxableInPaise: '400000',
            cgstTcsInPaise: '0',
            sgstTcsInPaise: '0',
            igstTcsInPaise: '4000',
            totalTcsInPaise: '4000',
          },
        ],
      },
    ]);
    const json = await svc.generateJsonPayload('2026-04', '07PLATFORM1234F1Z5');
    expect(json.details).toHaveLength(2);
    expect(json.tot_supp_in_paise).toBe('1000000');
    expect(json.tot_tcs_in_paise).toBe('10000');
  });

  it('uses operatorGstin as the top-level gstin', async () => {
    const svc = makeService([]);
    const json = await svc.generateJsonPayload(
      '2026-04',
      '07PLATFORM1234F1Z5',
    );
    expect(json.gstin).toBe('07PLATFORM1234F1Z5');
  });
});

describe('Gstr8ReportService.summarise', () => {
  it('returns zeros + empty rows on NIL period', async () => {
    const svc = makeService([]);
    const s = await svc.summarise({ filingPeriod: '2026-04' });
    expect(s.sellerCount).toBe(0);
    expect(s.totalGrossInPaise).toBe(0n);
    expect(s.totalTcsInPaise).toBe(0n);
    expect(s.rows).toEqual([]);
    expect(s.filingPeriod).toBe('2026-04');
    // Phase 159z (audit #14) — pagination fields are present.
    expect(s.page).toBe(1);
    expect(s.totalPages).toBe(1);
  });

  it('forwards page + pageSize to the paginated listForPeriod', async () => {
    const svc = makeService([SAMPLE_LEDGER_INTRA]);
    await svc.summarise({ filingPeriod: '2026-04', page: 2, pageSize: 25 });
    // The mock was set up to return rows regardless; verify the
    // delegation by inspecting the call args.
    const tcs = (svc as any).tcs as MockTcs;
    expect(tcs.listForPeriodPaginated).toHaveBeenCalledWith({
      filingPeriod: '2026-04',
      page: 2,
      pageSize: 25,
    });
  });
});

describe('Gstr8ReportService.streamCsv', () => {
  it('emits header + one row per (supplier, PoS) via res.write', async () => {
    const svc = makeService([SAMPLE_LEDGER_INTRA]);
    const writes: string[] = [];
    const res: any = {
      write: (chunk: string) => {
        writes.push(chunk);
      },
      end: jest.fn(),
    };
    const result = await svc.streamCsv(res, '2026-04');
    expect(writes[0]).toContain('GSTIN of Supplier');
    expect(writes.length).toBeGreaterThan(1);
    expect(result.rowsEmitted).toBe(1);
    expect(result.bytesWritten).toBeGreaterThan(0);
    expect(res.end).toHaveBeenCalled();
  });
});
