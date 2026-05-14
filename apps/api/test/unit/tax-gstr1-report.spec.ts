import 'reflect-metadata';
import { Gstr1ReportService } from '../../src/modules/tax/application/services/gstr1-report.service';

// Phase 18 GST — Gstr1ReportService tests.
//
// Unit-level: prisma is mocked; the aggregator is exercised in
// tax-gstr1-aggregator.spec.ts. These tests cover the CSV header
// shape + period→UTC-range translation + paise→rupees rendering.

function makeService(documents: any[] = []): {
  service: Gstr1ReportService;
  prisma: any;
} {
  const prisma = {
    taxDocument: {
      findMany: jest.fn().mockResolvedValue(documents),
    },
  };
  const service = new Gstr1ReportService(prisma as any);
  return { service, prisma };
}

describe('Gstr1ReportService.aggregateForSeller', () => {
  it('applies the IST-aware month range and seller filter', async () => {
    const { service, prisma } = makeService([]);
    await service.aggregateForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const where = prisma.taxDocument.findMany.mock.calls[0][0].where;
    expect(where.sellerId).toBe('s-1');
    expect(where.status.notIn).toEqual(['VOIDED_DRAFT', 'SUPERSEDED']);
    // 1 Apr IST = 31 Mar 18:30 UTC; 1 May IST = 30 Apr 18:30 UTC.
    expect(where.generatedAt.gte.toISOString()).toBe(
      '2026-03-31T18:30:00.000Z',
    );
    expect(where.generatedAt.lt.toISOString()).toBe(
      '2026-04-30T18:30:00.000Z',
    );
  });

  it('rejects malformed filing periods', async () => {
    const { service } = makeService();
    await expect(
      service.aggregateForSeller({ sellerId: 's-1', filingPeriod: '202604' }),
    ).rejects.toThrow(/Invalid filing period/);
  });
});

describe('Gstr1ReportService.generateB2bCsv', () => {
  it('emits header-only CSV when no B2B invoices', async () => {
    const { service } = makeService([]);
    const csv = await service.generateB2bCsv({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    expect(csv.split('\n')).toHaveLength(1);
    expect(csv).toMatch(/Invoice Number,Invoice Date,Buyer GSTIN/);
  });

  it('emits a row per B2B invoice with paise→rupees conversion', async () => {
    const { service } = makeService([
      {
        id: 'd-1',
        documentNumber: 'SM-INV-000001',
        documentType: 'TAX_INVOICE',
        generatedAt: new Date(Date.UTC(2026, 3, 15)),
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
        status: 'GENERATED',
        lines: [],
      },
    ]);
    const csv = await service.generateB2bCsv({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const data = csv.split('\n')[1].split(',');
    expect(data[0]).toBe('SM-INV-000001');
    expect(data[1]).toBe('2026-04-15');
    expect(data[2]).toBe('07AAGCB1234C1Z5');
    expect(data[3]).toBe('07');
    expect(data[4]).toBe('1180.00'); // ₹1,180 invoice total
    expect(data[5]).toBe('1000.00'); // ₹1,000 taxable
    expect(data[8]).toBe('180.00');  // ₹180 IGST
    expect(data[10]).toBe('N');
  });
});

describe('Gstr1ReportService.generateB2cSmallCsv', () => {
  it('emits rate as percentage (1800 bps → 18.00)', async () => {
    const { service } = makeService([
      {
        id: 'd-1',
        documentNumber: 'SM-INV-1',
        documentType: 'TAX_INVOICE',
        generatedAt: new Date(Date.UTC(2026, 3, 15)),
        buyerGstin: null,
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
        status: 'GENERATED',
        lines: [
          {
            hsnOrSacCode: '6404',
            uqcCode: 'PCS',
            quantity: 1,
            gstRateBps: 1800,
            taxableAmountInPaise: 50_000n,
            cgstAmountInPaise: 0n,
            sgstAmountInPaise: 0n,
            igstAmountInPaise: 9_000n,
            cessAmountInPaise: 0n,
            totalTaxAmountInPaise: 9_000n,
          },
        ],
      },
    ]);
    const csv = await service.generateB2cSmallCsv({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const data = csv.split('\n')[1].split(',');
    expect(data[0]).toBe('07');
    expect(data[1]).toBe('18.00');
  });
});

describe('Gstr1ReportService.generateHsnSummaryCsv', () => {
  it('emits HSN summary rows', async () => {
    const { service } = makeService([
      {
        id: 'd-1',
        documentNumber: 'SM-INV-1',
        documentType: 'TAX_INVOICE',
        generatedAt: new Date(Date.UTC(2026, 3, 15)),
        buyerGstin: null,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        taxableAmountInPaise: 100_000n,
        cgstAmountInPaise: 9_000n,
        sgstAmountInPaise: 9_000n,
        igstAmountInPaise: 0n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 118_000n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        status: 'GENERATED',
        lines: [
          {
            hsnOrSacCode: '6404',
            uqcCode: 'PCS',
            quantity: 2,
            gstRateBps: 1800,
            taxableAmountInPaise: 100_000n,
            cgstAmountInPaise: 9_000n,
            sgstAmountInPaise: 9_000n,
            igstAmountInPaise: 0n,
            cessAmountInPaise: 0n,
            totalTaxAmountInPaise: 18_000n,
          },
        ],
      },
    ]);
    const csv = await service.generateHsnSummaryCsv({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    const data = lines[1].split(',');
    expect(data[0]).toBe('6404');
    expect(data[1]).toBe('PCS');
    expect(data[2]).toBe('18.00');
    expect(data[3]).toBe('2'); // total qty
    expect(data[5]).toBe('1000.00'); // taxable
    expect(data[6]).toBe('90.00');   // CGST
    expect(data[7]).toBe('90.00');   // SGST
  });
});

describe('Gstr1ReportService.generateDocumentsIssuedCsv', () => {
  it('counts by document type', async () => {
    const { service } = makeService([
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'a',
        generatedAt: new Date(Date.UTC(2026, 3, 1)),
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
        lines: [],
      },
      {
        documentType: 'TAX_INVOICE',
        documentNumber: 'b',
        generatedAt: new Date(Date.UTC(2026, 3, 2)),
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
        lines: [],
      },
      {
        documentType: 'LEGACY_RECEIPT',
        documentNumber: 'c',
        generatedAt: new Date(Date.UTC(2026, 3, 3)),
        buyerGstin: null,
        sellerStateCode: null,
        placeOfSupplyStateCode: null,
        taxableAmountInPaise: 0n,
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 0n,
        cessAmountInPaise: 0n,
        documentTotalInPaise: 0n,
        reverseChargeApplicable: false,
        originalDocumentNumber: null,
        lines: [],
      },
    ]);
    const csv = await service.generateDocumentsIssuedCsv({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const data = csv.split('\n').slice(1);
    // Sorted alphabetically: LEGACY_RECEIPT, TAX_INVOICE.
    expect(data[0]).toBe('LEGACY_RECEIPT,1');
    expect(data[1]).toBe('TAX_INVOICE,2');
  });
});
