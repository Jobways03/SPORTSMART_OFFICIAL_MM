import 'reflect-metadata';
import { Gstr3bReportService } from '../../src/modules/tax/application/services/gstr3b-report.service';

// Phase 18 GST — Gstr3bReportService tests.
//
// Section 3.1 = total outward taxable (netting credit notes).
// Section 3.2 = inter-state B2C by place of supply.

function makeService(documents: any[] = []): {
  service: Gstr3bReportService;
  prisma: any;
} {
  const prisma = {
    taxDocument: {
      findMany: jest.fn().mockResolvedValue(documents),
    },
  };
  return { service: new Gstr3bReportService(prisma as any), prisma };
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
  it('emits 4 rows (3.1 a/b/c/e) regardless of period contents', async () => {
    const { service } = makeService([]);
    const csv = await service.generateCsv({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const lines = csv.split('\n');
    expect(lines).toHaveLength(5); // header + 4 rows
    expect(lines[1]).toMatch(/^3\.1\(a\),/);
    expect(lines[2]).toMatch(/^3\.1\(b\),/);
    expect(lines[3]).toMatch(/^3\.1\(c\),/);
    expect(lines[4]).toMatch(/^3\.1\(e\),/);
  });
});
