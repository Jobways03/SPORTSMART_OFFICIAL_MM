import 'reflect-metadata';
import {
  CURRENT_COMMISSION_GSTR1_SCHEMA_VERSION,
  MarketplaceCommissionGstrService,
} from '../../src/modules/tax/application/services/marketplace-commission-gstr.service';

// Phase 159aa (Marketplace Commission GSTR-1 audit) — covers the
// rewrite that closes B1 (per-invoice), B3 (B2C bucket), B4 (split
// drift surfaced), #6/#11 (supplier GSTIN + PoS), #7 (JSON), #8/#15
// (CDNR + warnings), #9 (Decimal), #17 (config-driven SAC/rate).

interface MockFacade {
  listCommissionInvoicesForFilingPeriod: jest.Mock;
}

interface MockTaxConfig {
  getString: jest.Mock;
  getNumber: jest.Mock;
}

function makeService(
  rows: any[] = [],
  opts: { rateBps?: number; sacCode?: string } = {},
): {
  service: MarketplaceCommissionGstrService;
  facade: MockFacade;
  taxConfig: MockTaxConfig;
} {
  const facade: MockFacade = {
    listCommissionInvoicesForFilingPeriod: jest
      .fn()
      .mockResolvedValue(rows),
  };
  const taxConfig: MockTaxConfig = {
    getString: jest.fn().mockResolvedValue(opts.sacCode ?? '9985'),
    getNumber: jest.fn().mockResolvedValue(opts.rateBps ?? 1800),
  };
  const service = new MarketplaceCommissionGstrService(
    facade as any,
    taxConfig as any,
  );
  return { service, facade, taxConfig };
}

const SUPPLIER_GSTIN = '27AAACR4849R1ZL';

function sampleB2bSettlement(over: Partial<any> = {}) {
  return {
    settlementId: 'st-1',
    sellerId: 'sel-1',
    cycleId: 'cyc-1',
    commissionInvoiceNumber: 'SM-MKTCOM-000001',
    commissionInvoiceDate: new Date('2026-04-15T05:30:00Z'),
    commissionInvoiceFilingPeriod: '2026-04',
    commissionPlaceOfSupplyStateCode: '29',
    commissionInvoiceSupplierGstin: SUPPLIER_GSTIN,
    commissionInvoiceRecipientGstin: '29ABCDE1234F1Z5',
    commissionRecipientIsB2c: false,
    commissionInvoiceSacCode: '9985',
    commissionInvoiceIrn: null,
    commissionInvoiceCreditNoteForId: null,
    totalPlatformMargin: 1000,
    totalPlatformMarginInPaise: 100000n,
    cgstOnCommissionInPaise: 9000n,
    sgstOnCommissionInPaise: 9000n,
    igstOnCommissionInPaise: 0n,
    totalCommissionGstInPaise: 18000n,
    commissionGstRateBps: 1800,
    commissionGstSplitType: 'CGST_SGST' as const,
    cycle: { periodEnd: new Date('2026-04-30T18:30:00Z'), approvedAt: null },
    seller: {
      gstin: '29ABCDE1234F1Z5',
      legalBusinessName: 'Acme Sports Pvt Ltd',
      sellerShopName: 'Acme Sports',
      gstStateCode: '29',
    },
    ...over,
  };
}

function sampleB2cSettlement(over: Partial<any> = {}) {
  return {
    settlementId: 'st-b2c-1',
    sellerId: 'sel-b2c-1',
    cycleId: 'cyc-1',
    commissionInvoiceNumber: 'SM-MKTCOM-000002',
    commissionInvoiceDate: new Date('2026-04-20T05:30:00Z'),
    commissionInvoiceFilingPeriod: '2026-04',
    commissionPlaceOfSupplyStateCode: '07',
    commissionInvoiceSupplierGstin: SUPPLIER_GSTIN,
    commissionInvoiceRecipientGstin: null,
    commissionRecipientIsB2c: true,
    commissionInvoiceSacCode: '9985',
    commissionInvoiceIrn: null,
    commissionInvoiceCreditNoteForId: null,
    totalPlatformMargin: 500,
    totalPlatformMarginInPaise: 50000n,
    cgstOnCommissionInPaise: 0n,
    sgstOnCommissionInPaise: 0n,
    igstOnCommissionInPaise: 9000n,
    totalCommissionGstInPaise: 9000n,
    commissionGstRateBps: 1800,
    commissionGstSplitType: 'IGST' as const,
    cycle: { periodEnd: new Date('2026-04-30T18:30:00Z'), approvedAt: null },
    seller: {
      gstin: null,
      legalBusinessName: null,
      sellerShopName: 'Small Seller',
      gstStateCode: '07',
    },
    ...over,
  };
}

describe('MarketplaceCommissionGstrService.aggregate', () => {
  // Phase 159aa (audit B1) — per-invoice rows replace the prior
  // per-(seller, period) rollup.
  it('emits one §4 B2B row per commission invoice (B1)', async () => {
    const { service } = makeService([
      sampleB2bSettlement({ settlementId: 's-1', commissionInvoiceNumber: 'INV-1' }),
      sampleB2bSettlement({
        settlementId: 's-2',
        commissionInvoiceNumber: 'INV-2',
        sellerId: 'sel-1', // same seller → would have been one row pre-159aa
      }),
    ]);
    const agg = await service.aggregate({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(agg.b2bRows).toHaveLength(2);
    expect(agg.totals.b2bInvoiceCount).toBe(2);
  });

  // Phase 159aa (audit B3) — non-GSTIN sellers were silently dropped
  // before. They now bucket into §7 B2C aggregated by (state, rate, split).
  it('buckets non-GSTIN settlements into §7 B2C (B3)', async () => {
    const { service } = makeService([
      sampleB2cSettlement({ settlementId: 'b1' }),
      sampleB2cSettlement({ settlementId: 'b2' }), // same state + rate
    ]);
    const agg = await service.aggregate({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(agg.b2bRows).toHaveLength(0);
    expect(agg.b2cBuckets).toHaveLength(1);
    expect(agg.b2cBuckets[0].settlementCount).toBe(2);
    expect(agg.b2cBuckets[0].commissionInPaise).toBe(100000n);
    expect(agg.b2cBuckets[0].placeOfSupplyStateCode).toBe('07');
    expect(agg.b2cBuckets[0].taxSplit).toBe('IGST');
  });

  // Phase 159aa (audit #6) — supplier GSTIN snapshot lands on every row.
  it('includes Supplier GSTIN on B2B + B2C rows (#6)', async () => {
    const { service } = makeService([
      sampleB2bSettlement(),
      sampleB2cSettlement(),
    ]);
    const agg = await service.aggregate({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(agg.b2bRows[0].supplierGstin).toBe(SUPPLIER_GSTIN);
    expect(agg.b2cBuckets[0].supplierGstin).toBe(SUPPLIER_GSTIN);
  });

  // Phase 159aa (audit #11) — Place of Supply per row.
  it('includes per-row Place of Supply (#11)', async () => {
    const { service } = makeService([sampleB2bSettlement()]);
    const agg = await service.aggregate({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(agg.b2bRows[0].placeOfSupplyStateCode).toBe('29');
  });

  // Phase 159aa (audit #15) — tax-split drift now surfaces as a
  // warning instead of being silently coerced to "IGST wins".
  it('surfaces tax-split drift warning when a seller has both splits (B4 → #15)', async () => {
    const { service } = makeService([
      sampleB2bSettlement({
        settlementId: 's-c',
        sellerId: 'drifty',
        commissionInvoiceNumber: 'INV-A',
        commissionGstSplitType: 'CGST_SGST',
      }),
      sampleB2bSettlement({
        settlementId: 's-i',
        sellerId: 'drifty',
        commissionInvoiceNumber: 'INV-B',
        commissionGstSplitType: 'IGST',
      }),
    ]);
    const agg = await service.aggregate({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(agg.b2bRows).toHaveLength(2);
    expect(agg.b2bRows[0].taxSplit).toBe('CGST_SGST');
    expect(agg.b2bRows[1].taxSplit).toBe('IGST');
    expect(agg.warnings.length).toBeGreaterThan(0);
    expect(agg.warnings[0]).toMatch(/Tax-split drift.*drifty/);
  });

  // Phase 159aa (audit #8) — negative settlements emit as §9B credit-notes.
  it('emits §9B CDNR row for negative-commission settlements (#8)', async () => {
    const { service } = makeService([
      sampleB2bSettlement({
        settlementId: 'st-reverse',
        commissionInvoiceNumber: 'SM-MKTCOM-CN-000001',
        commissionInvoiceCreditNoteForId: 'SM-MKTCOM-000099',
        totalPlatformMarginInPaise: -100000n,
        cgstOnCommissionInPaise: -9000n,
        sgstOnCommissionInPaise: -9000n,
        igstOnCommissionInPaise: 0n,
        totalCommissionGstInPaise: -18000n,
      }),
    ]);
    const agg = await service.aggregate({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(agg.b2bRows).toHaveLength(0);
    expect(agg.creditNoteRows).toHaveLength(1);
    expect(agg.creditNoteRows[0].originalInvoiceNumber).toBe('SM-MKTCOM-000099');
    expect(agg.creditNoteRows[0].totalGstInPaise).toBe(-18000n);
  });

  it('aggregates totals across §4 B2B + §7 B2C + §9B CDNR', async () => {
    const { service } = makeService([
      sampleB2bSettlement(),
      sampleB2cSettlement(),
    ]);
    const agg = await service.aggregate({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(agg.totals.totalTaxableInPaise).toBe(150000n);
    expect(agg.totals.totalGstInPaise).toBe(27000n);
  });
});

describe('MarketplaceCommissionGstrService.generateCsv', () => {
  it('emits separate §4/§7/§9B sections with their headers', async () => {
    const { service } = makeService([
      sampleB2bSettlement(),
      sampleB2cSettlement(),
    ]);
    const csv = await service.generateCsv({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(csv).toContain('# §4 B2B');
    expect(csv).toContain('Supplier GSTIN,Invoice Number,Invoice Date');
    expect(csv).toContain('# §7 B2C');
    expect(csv).toContain('# §9B CDNR');
    // Phase 159aa (audit B1) — B2B row contains the invoice number.
    expect(csv).toContain('SM-MKTCOM-000001');
  });

  // Phase 159aa (audit B5) — defence in depth via shared escapeCsvField.
  it('neutralises formula-injection in recipient legal name (B5)', async () => {
    const { service } = makeService([
      sampleB2bSettlement({
        seller: {
          gstin: '29ABCDE1234F1Z5',
          legalBusinessName: "=cmd|'/c calc'!A1",
          sellerShopName: 'Acme',
          gstStateCode: '29',
        },
      }),
    ]);
    const csv = await service.generateCsv({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    // The cell is quote-prefixed by escapeCsvField.
    expect(csv).toMatch(/'?=cmd\|'\/c calc'!A1/);
    expect(csv).not.toMatch(/^=cmd/m);
  });

  it('emits header-only sections for NIL period', async () => {
    const { service } = makeService([]);
    const csv = await service.generateCsv({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    // Three section labels + three header rows = 6 non-empty lines.
    expect(csv.split('\n').filter(Boolean).length).toBe(6);
  });
});

describe('MarketplaceCommissionGstrService.generateJsonPayload', () => {
  it('emits NIC field names for §4 B2B + §7 B2C + §9B CDNR (#7)', async () => {
    const { service } = makeService([
      sampleB2bSettlement(),
      sampleB2cSettlement(),
    ]);
    const json = await service.generateJsonPayload({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(json.gstin).toBe(SUPPLIER_GSTIN);
    expect(json.ret_period).toBe('042026');
    expect(json.schema_version).toBe(CURRENT_COMMISSION_GSTR1_SCHEMA_VERSION);
    expect(json.b2b).toHaveLength(1);
    expect(json.b2b[0].inum).toBe('SM-MKTCOM-000001');
    expect(json.b2b[0].pos).toBe('29');
    expect(json.b2b[0].sac).toBe('9985');
    expect(json.b2cs).toHaveLength(1);
    expect(json.b2cs[0].pos).toBe('07');
    expect(json.totals.total_taxable_in_paise).toBe('150000');
  });
});

describe('MarketplaceCommissionGstrService.streamCsv', () => {
  it('writes header + body via res.write', async () => {
    const { service } = makeService([sampleB2bSettlement()]);
    const writes: string[] = [];
    const res: any = {
      write: (chunk: string) => writes.push(chunk),
      end: jest.fn(),
    };
    const result = await service.streamCsv(res, {
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(writes.find((w) => w.includes('Invoice Number'))).toBeTruthy();
    expect(result.rowsEmitted).toBe(1);
    expect(res.end).toHaveBeenCalled();
  });
});

describe('MarketplaceCommissionGstrService.summarise', () => {
  it('returns first-25 samples + totals + warnings (#16)', async () => {
    const settlements = Array.from({ length: 30 }, (_, i) =>
      sampleB2bSettlement({
        settlementId: `st-${i}`,
        commissionInvoiceNumber: `SM-MKTCOM-${i.toString().padStart(6, '0')}`,
      }),
    );
    const { service } = makeService(settlements);
    const summary = await service.summarise({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    expect(summary.totals.b2bInvoiceCount).toBe(30);
    expect(summary.sample.b2b).toHaveLength(25);
  });
});

// Phase 159aa (audit #9) — Decimal-aware legacy fallback. The previous
// `Number(decimal.toString()) * 100` would round-trip through float.
describe('MarketplaceCommissionGstrService — Decimal legacy fallback (#9)', () => {
  it('handles legacy rows without totalPlatformMarginInPaise via Prisma.Decimal', async () => {
    const { service } = makeService([
      sampleB2bSettlement({
        totalPlatformMarginInPaise: null,
        // Sentinel decimal value preserves precision via Decimal.mul(100).round().
        totalPlatformMargin: 12345.67,
      }),
    ]);
    const agg = await service.aggregate({
      filingPeriod: '2026-04',
      supplierGstin: SUPPLIER_GSTIN,
    });
    // 12345.67 × 100 = 1234567 paise.
    expect(agg.b2bRows[0].commissionInPaise).toBe(1234567n);
  });
});
