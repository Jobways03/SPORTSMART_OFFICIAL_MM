import 'reflect-metadata';
import { Gstr8ReportService } from '../../src/modules/tax/application/services/gstr8-report.service';

// Phase 16 GST — Gstr8ReportService tests.
//
// Covers CSV / JSON output shapes + period-level summary. The TCS
// service is stubbed via the listForPeriod method only — the calc
// pipeline itself is exercised in tax-tcs-calculator + tax-tcs-service.

function makeService(rows: any[] = []): Gstr8ReportService {
  const tcs: any = {
    listForPeriod: jest.fn().mockResolvedValue(rows),
  };
  return new Gstr8ReportService(tcs);
}

describe('Gstr8ReportService.generateCsv', () => {
  it('produces header-only CSV for empty periods (NIL filing)', async () => {
    const svc = makeService([]);
    const csv = await svc.generateCsv('2026-04');
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      'GSTIN of Supplier,Trade Name,Gross Supply Value,Credit Note Reversal,Net Taxable Supply,CGST TCS,SGST TCS,IGST TCS,Total TCS,Filing Period',
    );
  });

  it('emits one row per ledger entry with paise→rupees conversion', async () => {
    const svc = makeService([
      {
        supplierGstin: '29ABCDE1234F1Z5',
        grossTaxableSupplyInPaise: 1_000_000n,
        creditNoteReversalInPaise: 200_000n,
        netTaxableSupplyInPaise: 800_000n,
        cgstTcsInPaise: 4_000n,
        sgstTcsInPaise: 4_000n,
        igstTcsInPaise: 0n,
        totalTcsInPaise: 8_000n,
        filingPeriod: '2026-04',
      },
    ]);
    const csv = await svc.generateCsv('2026-04');
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    const data = lines[1].split(',');
    expect(data[0]).toBe('29ABCDE1234F1Z5');
    expect(data[2]).toBe('10000.00'); // ₹10,000 gross
    expect(data[3]).toBe('2000.00');  // ₹2,000 reversal
    expect(data[4]).toBe('8000.00');  // ₹8,000 net
    expect(data[5]).toBe('40.00');    // ₹40 CGST TCS
    expect(data[6]).toBe('40.00');    // ₹40 SGST TCS
    expect(data[7]).toBe('0.00');
    expect(data[8]).toBe('80.00');    // ₹80 total
    expect(data[9]).toBe('2026-04');
  });

  it('formats sub-rupee amounts correctly (paise padding)', async () => {
    const svc = makeService([
      {
        supplierGstin: '29ABCDE1234F1Z5',
        grossTaxableSupplyInPaise: 5n, // 5 paise
        creditNoteReversalInPaise: 0n,
        netTaxableSupplyInPaise: 5n,
        cgstTcsInPaise: 0n,
        sgstTcsInPaise: 0n,
        igstTcsInPaise: 0n,
        totalTcsInPaise: 0n,
        filingPeriod: '2026-04',
      },
    ]);
    const csv = await svc.generateCsv('2026-04');
    const data = csv.split('\n')[1].split(',');
    expect(data[2]).toBe('0.05'); // 5 paise → ₹0.05
  });

  it('preserves header column order (load-bearing for upload tooling)', async () => {
    const svc = makeService([]);
    const csv = await svc.generateCsv('2026-04');
    const header = csv.split('\n')[0].split(',');
    expect(header).toEqual([
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
    ]);
  });
});

describe('Gstr8ReportService.generateJsonPayload', () => {
  it('produces empty details array on NIL period', async () => {
    const svc = makeService([]);
    const json = await svc.generateJsonPayload('2026-04', '29ABCDE1234F1Z5');
    expect(json.details).toEqual([]);
    expect(json.tot_supp_in_paise).toBe('0');
    expect(json.tot_tcs_in_paise).toBe('0');
  });

  it('converts YYYY-MM to MMYYYY per CBIC convention', async () => {
    const svc = makeService([]);
    const json = await svc.generateJsonPayload('2026-04', '29ABCDE1234F1Z5');
    expect(json.ret_period).toBe('042026');
  });

  it('serialises BigInt to string for JSON safety', async () => {
    const svc = makeService([
      {
        supplierGstin: '29ABCDE1234F1Z5',
        grossTaxableSupplyInPaise: 1_000_000n,
        creditNoteReversalInPaise: 200_000n,
        netTaxableSupplyInPaise: 800_000n,
        cgstTcsInPaise: 4_000n,
        sgstTcsInPaise: 4_000n,
        igstTcsInPaise: 0n,
        totalTcsInPaise: 8_000n,
        filingPeriod: '2026-04',
      },
    ]);
    const json = await svc.generateJsonPayload('2026-04', '29ABCDE1234F1Z5');
    expect(json.details).toHaveLength(1);
    expect(json.details[0].gross_supply_in_paise).toBe('1000000');
    expect(json.details[0].total_tcs_in_paise).toBe('8000');
    expect(json.tot_supp_in_paise).toBe('1000000');
    expect(json.tot_tcs_in_paise).toBe('8000');
    // Confirm the whole payload is JSON-roundtrippable.
    expect(() => JSON.parse(JSON.stringify(json))).not.toThrow();
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
    const s = await svc.summarise('2026-04');
    expect(s.sellerCount).toBe(0);
    expect(s.totalGrossInPaise).toBe(0n);
    expect(s.totalTcsInPaise).toBe(0n);
    expect(s.rows).toEqual([]);
    expect(s.filingPeriod).toBe('2026-04');
  });

  it('aggregates across multiple sellers', async () => {
    const svc = makeService([
      {
        supplierGstin: 'a',
        grossTaxableSupplyInPaise: 100_000n,
        creditNoteReversalInPaise: 0n,
        netTaxableSupplyInPaise: 100_000n,
        cgstTcsInPaise: 500n,
        sgstTcsInPaise: 500n,
        igstTcsInPaise: 0n,
        totalTcsInPaise: 1_000n,
      },
      {
        supplierGstin: 'b',
        grossTaxableSupplyInPaise: 200_000n,
        creditNoteReversalInPaise: 50_000n,
        netTaxableSupplyInPaise: 150_000n,
        cgstTcsInPaise: 0n,
        sgstTcsInPaise: 0n,
        igstTcsInPaise: 1_500n,
        totalTcsInPaise: 1_500n,
      },
    ]);
    const s = await svc.summarise('2026-04');
    expect(s.sellerCount).toBe(2);
    expect(s.totalGrossInPaise).toBe(300_000n);
    expect(s.totalCreditNoteReversalInPaise).toBe(50_000n);
    expect(s.totalNetTaxableInPaise).toBe(250_000n);
    expect(s.totalCgstTcsInPaise).toBe(500n);
    expect(s.totalSgstTcsInPaise).toBe(500n);
    expect(s.totalIgstTcsInPaise).toBe(1_500n);
    expect(s.totalTcsInPaise).toBe(2_500n);
  });
});
