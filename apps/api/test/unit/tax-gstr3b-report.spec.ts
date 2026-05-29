import 'reflect-metadata';
import { Gstr3bReportService } from '../../src/modules/tax/application/services/gstr3b-report.service';

// Phase 18 GST — Gstr3bReportService tests.
//
// Section 3.1 = total outward taxable (netting credit notes).
// Section 3.2 = inter-state B2C by place of supply.

function makeService(
  documents: any[] = [],
  seller: any = { id: 's-1', gstins: [{ id: 'g-1' }] }, // Phase 159y (#10)
): {
  service: Gstr3bReportService;
  prisma: any;
} {
  const prisma = {
    seller: { findUnique: jest.fn().mockResolvedValue(seller) },
    taxDocument: {
      findMany: jest.fn().mockResolvedValue(documents),
    },
  };
  return { service: new Gstr3bReportService(prisma as any), prisma };
}

// A line-bearing outward doc helper for the Phase 159y §3.1(b/c/e) tests.
function docWithLines(over: any, lines: any[]) {
  return {
    documentType: 'TAX_INVOICE',
    documentNumber: 'INV-1',
    generatedAt: new Date(Date.UTC(2026, 3, 10)),
    buyerGstin: null,
    sellerStateCode: '29',
    placeOfSupplyStateCode: '29',
    taxableAmountInPaise: 0n,
    cgstAmountInPaise: 0n,
    sgstAmountInPaise: 0n,
    igstAmountInPaise: 0n,
    cessAmountInPaise: 0n,
    documentTotalInPaise: 0n,
    reverseChargeApplicable: false,
    originalDocumentNumber: null,
    irn: null,
    ackDate: null,
    ...over,
    lines,
  };
}

describe('Gstr3bReportService.summariseForSeller', () => {
  it('returns zeros on an empty period', async () => {
    const { service } = makeService([]);
    const s = await service.summariseForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    expect(s.section31.outwardTaxableInPaise).toBe(0n);
    expect(s.section31.cgstInPaise).toBe(0n);
    expect(s.section31.sgstInPaise).toBe(0n);
    expect(s.section31.igstInPaise).toBe(0n);
    expect(s.section32).toEqual([]);
  });

  it('aggregates outward taxable + tax across invoices', async () => {
    const { service } = makeService([
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'a',
        generatedAt: new Date(Date.UTC(2026, 3, 10)),
        buyerGstin: '07AAGCB1234C1Z5',
        sellerStateCode: '29',
        placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 100_000n,
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 18_000n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 118_000n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        lines: [],
      },
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'b',
        generatedAt: new Date(Date.UTC(2026, 3, 12)),
        buyerGstin: null,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        taxableAmountInPaise: 50_000n,
        cgstAmountInPaise: 4_500n,
        sgstAmountInPaise: 4_500n,
        igstAmountInPaise: 0n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 59_000n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        lines: [],
      },
    ]);

    const s = await service.summariseForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    expect(s.section31.outwardTaxableInPaise).toBe(150_000n);
    expect(s.section31.cgstInPaise).toBe(4_500n);
    expect(s.section31.sgstInPaise).toBe(4_500n);
    expect(s.section31.igstInPaise).toBe(18_000n);
  });

  it('nets credit notes against outward supplies (3.1)', async () => {
    const { service } = makeService([
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'a',
        generatedAt: new Date(Date.UTC(2026, 3, 10)),
        buyerGstin: '07AAGCB1234C1Z5',
        sellerStateCode: '29',
        placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 200_000n,
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 36_000n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 236_000n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        lines: [],
      },
      {
        documentType: 'CREDIT_NOTE',
        documentNumber: 'cn-1',
        generatedAt: new Date(Date.UTC(2026, 3, 20)),
        buyerGstin: '07AAGCB1234C1Z5',
        sellerStateCode: '29',
        placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 50_000n,
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 9_000n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 59_000n,
        reverseChargeApplicable: false,
        originalDocumentNumber: 'a',
        lines: [],
      },
    ]);

    const s = await service.summariseForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    expect(s.section31.outwardTaxableInPaise).toBe(150_000n);
    expect(s.section31.igstInPaise).toBe(27_000n);
  });

  it('clamps net negative at zero when credit notes exceed invoices', async () => {
    const { service } = makeService([
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'a',
        generatedAt: new Date(Date.UTC(2026, 3, 10)),
        buyerGstin: '07AAGCB1234C1Z5',
        sellerStateCode: '29',
        placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 50_000n,
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 9_000n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 59_000n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        lines: [],
      },
      {
        documentType: 'CREDIT_NOTE',
        documentNumber: 'cn-1',
        generatedAt: new Date(Date.UTC(2026, 3, 20)),
        buyerGstin: '07AAGCB1234C1Z5',
        sellerStateCode: '29',
        placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 100_000n, // reversal > original
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 18_000n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 118_000n,
        reverseChargeApplicable: false,
        originalDocumentNumber: 'a',
        lines: [],
      },
    ]);

    const s = await service.summariseForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    expect(s.section31.outwardTaxableInPaise).toBe(0n);
    expect(s.section31.igstInPaise).toBe(0n);
  });

  it('produces section 3.2 by place-of-supply state', async () => {
    const { service } = makeService([
      // Inter-state B2C Large → §5 → 3.2
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'a',
        generatedAt: new Date(Date.UTC(2026, 3, 10)),
        buyerGstin: null,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 300_000_00n,
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 54_000_00n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 354_000_00n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        lines: [],
      },
      // Intra-state B2C → §7 with CGST/SGST → NOT 3.2.
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'b',
        generatedAt: new Date(Date.UTC(2026, 3, 12)),
        buyerGstin: null,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        taxableAmountInPaise: 50_000n,
        cgstAmountInPaise: 4_500n,
        sgstAmountInPaise: 4_500n,
        igstAmountInPaise: 0n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 59_000n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        lines: [],
      },
    ]);

    const s = await service.summariseForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    expect(s.section32).toHaveLength(1);
    expect(s.section32[0].placeOfSupplyStateCode).toBe('07');
    expect(s.section32[0].totalTaxableInPaise).toBe(300_000_00n);
    expect(s.section32[0].totalIgstInPaise).toBe(54_000_00n);
  });
});

describe('Gstr3bReportService.generateCsv', () => {
  it('emits the §3.1 rows + a §3.2 section + an "outward only" disclaimer', async () => {
    const { service } = makeService([]);
    const csv = await service.generateCsv({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    // Disclaimer (audit #7/B4) + zero-period warning (#11).
    expect(csv).toMatch(/# GSTR-3B OUTWARD SUPPLIES/);
    expect(csv).toMatch(/NOT a complete GSTR-3B/);
    expect(csv).toMatch(/# WARNING: No outward documents/);
    // §3.1 a/b/c/e present.
    expect(csv).toMatch(/\n3\.1\(a\),/);
    expect(csv).toMatch(/\n3\.1\(b\),/);
    expect(csv).toMatch(/\n3\.1\(c\),/);
    expect(csv).toMatch(/\n3\.1\(e\),/);
    // §3.2 section now serialised (audit #1).
    expect(csv).toMatch(/Section 3\.2 — Inter-state supplies/);
    expect(csv).toMatch(/Place of Supply,Taxable Value,IGST/);
  });

  it('serialises §3.2 inter-state B2C rows into the CSV (audit #1)', async () => {
    const { service } = makeService([
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'a',
        generatedAt: new Date(Date.UTC(2026, 3, 10)),
        buyerGstin: null,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 300_000_00n,
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 54_000_00n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 354_000_00n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        lines: [],
      },
    ]);
    const csv = await service.generateCsv({ sellerId: 's-1', filingPeriod: '2026-04' });
    // The §3.2 row for state 07 must be present (was computed-but-dropped).
    expect(csv).toMatch(/\n07,300000\.00,54000\.00/);
  });
});

describe('Gstr3bReportService — Phase 159y hardening', () => {
  it('§3.1(b/c/e) — populates zero-rated / nil-exempt / non-GST from line taxability (audit #2)', async () => {
    const { service } = makeService([
      docWithLines(
        { documentType: 'BILL_OF_SUPPLY', documentNumber: 'bos-1' },
        [
          { taxableAmountInPaise: 10_000n, supplyTaxability: 'ZERO_RATED', cgstAmountInPaise: 0n, sgstAmountInPaise: 0n, igstAmountInPaise: 0n, cessAmountInPaise: 0n, gstRateBps: 0 },
          { taxableAmountInPaise: 20_000n, supplyTaxability: 'EXEMPT', cgstAmountInPaise: 0n, sgstAmountInPaise: 0n, igstAmountInPaise: 0n, cessAmountInPaise: 0n, gstRateBps: 0 },
          { taxableAmountInPaise: 30_000n, supplyTaxability: 'NON_GST', cgstAmountInPaise: 0n, sgstAmountInPaise: 0n, igstAmountInPaise: 0n, cessAmountInPaise: 0n, gstRateBps: 0 },
        ],
      ),
    ]);
    const s = await service.summariseForSeller({ sellerId: 's-1', filingPeriod: '2026-04' });
    expect(s.section31.outwardZeroRatedInPaise).toBe(10_000n); // 3.1(b)
    expect(s.section31.otherOutwardInPaise).toBe(20_000n); // 3.1(c)
    expect(s.section31.nonGstOutwardInPaise).toBe(30_000n); // 3.1(e)
  });

  it('§3.1(a) — a DEBIT_NOTE adds to outward, a CREDIT_NOTE subtracts (audit #14)', async () => {
    const base = (over: any) => ({
      documentType: 'TAX_INVOICE',
      documentNumber: 'x',
      generatedAt: new Date(Date.UTC(2026, 3, 10)),
      buyerGstin: '07AAGCB1234C1Z5',
      sellerStateCode: '29',
      placeOfSupplyStateCode: '07',
      taxableAmountInPaise: 0n,
      cgstAmountInPaise: 0n,
      sgstAmountInPaise: 0n,
      igstAmountInPaise: 0n,
      cessAmountInPaise: 0n,
      documentTotalInPaise: 0n,
      reverseChargeApplicable: false,
      originalDocumentNumber: null,
      lines: [],
      ...over,
    });
    const { service } = makeService([
      base({ documentNumber: 'inv', taxableAmountInPaise: 100_000n, igstAmountInPaise: 18_000n }),
      base({ documentType: 'DEBIT_NOTE', documentNumber: 'dn', taxableAmountInPaise: 20_000n, igstAmountInPaise: 3_600n, originalDocumentNumber: 'inv' }),
    ]);
    const s = await service.summariseForSeller({ sellerId: 's-1', filingPeriod: '2026-04' });
    // 100k + 20k debit note = 120k (debit note ADDS, not dropped/subtracted).
    expect(s.section31.outwardTaxableInPaise).toBe(120_000n);
    expect(s.section31.igstInPaise).toBe(21_600n);
  });

  it('warns on a net-negative (clamped) period (audit #6)', async () => {
    const { service } = makeService([
      {
        documentType: 'TAX_INVOICE', documentNumber: 'a', generatedAt: new Date(Date.UTC(2026, 3, 10)),
        buyerGstin: '07AAGCB1234C1Z5', sellerStateCode: '29', placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 50_000n, cgstAmountInPaise: 0n, sgstAmountInPaise: 0n, igstAmountInPaise: 9_000n,
        cessAmountInPaise: 0n, documentTotalInPaise: 59_000n, reverseChargeApplicable: false, originalDocumentNumber: null, lines: [],
      },
      {
        documentType: 'CREDIT_NOTE', documentNumber: 'cn', generatedAt: new Date(Date.UTC(2026, 3, 20)),
        buyerGstin: '07AAGCB1234C1Z5', sellerStateCode: '29', placeOfSupplyStateCode: '07',
        taxableAmountInPaise: 100_000n, cgstAmountInPaise: 0n, sgstAmountInPaise: 0n, igstAmountInPaise: 18_000n,
        cessAmountInPaise: 0n, documentTotalInPaise: 118_000n, reverseChargeApplicable: false, originalDocumentNumber: 'a', lines: [],
      },
    ]);
    const s = await service.summariseForSeller({ sellerId: 's-1', filingPeriod: '2026-04' });
    expect(s.section31.outwardTaxableInPaise).toBe(0n);
    expect(s.warnings.some((w) => /negative/.test(w))).toBe(true);
  });

  it('rejects an invalid seller (audit #10)', async () => {
    const { service } = makeService([], null);
    await expect(
      service.summariseForSeller({ sellerId: 'nope', filingPeriod: '2026-04' }),
    ).rejects.toThrow(/not found/);
    const noGstin = makeService([], { id: 's-1', gstins: [] });
    await expect(
      noGstin.service.summariseForSeller({ sellerId: 's-1', filingPeriod: '2026-04' }),
    ).rejects.toThrow(/no verified GSTIN/);
  });
});
