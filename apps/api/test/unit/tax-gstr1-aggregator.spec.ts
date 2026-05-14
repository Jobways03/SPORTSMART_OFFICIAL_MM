import 'reflect-metadata';
import {
  aggregateGstr1,
  type DocumentForGstr1,
} from '../../src/modules/tax/domain/gstr1-aggregator';

// Phase 18 GST — GSTR-1 aggregator pure-function tests.
//
// All money is in paise. Inputs mimic TaxDocument + TaxDocumentLine
// rows after a Prisma .findMany with `include: { lines: true }`.

function makeInvoice(
  o: Partial<DocumentForGstr1> = {},
): DocumentForGstr1 {
  return {
    id: 'doc-1',
    documentNumber: 'SM-INV-000001',
    documentType: 'TAX_INVOICE',
    generatedAt: new Date(Date.UTC(2026, 3, 15)),
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
    ...o,
  };
}

describe('aggregateGstr1', () => {
  it('returns empty buckets for an empty list', () => {
    const r = aggregateGstr1([]);
    expect(r.b2b).toEqual([]);
    expect(r.b2cLarge).toEqual([]);
    expect(r.b2cSmall).toEqual([]);
    expect(r.creditNotes).toEqual([]);
    expect(r.hsn).toEqual([]);
    expect(r.documentsIssued).toEqual([]);
    expect(r.totals.taxableInPaise).toBe(0n);
  });

  it('puts a B2B invoice into §4', () => {
    const inv = makeInvoice({
      buyerGstin: '07AAGCB1234C1Z5',
      placeOfSupplyStateCode: '07',
      taxableAmountInPaise: 100_000n,
      igstInPaise: 18_000n,
      documentTotalInPaise: 118_000n,
    } as any);
    inv.igstAmountInPaise = 18_000n;
    const r = aggregateGstr1([inv]);
    expect(r.b2b).toHaveLength(1);
    expect(r.b2b[0].buyerGstin).toBe('07AAGCB1234C1Z5');
    expect(r.b2cLarge).toHaveLength(0);
    expect(r.b2cSmall).toHaveLength(0);
    expect(r.totals.taxableInPaise).toBe(100_000n);
  });

  it('puts an inter-state B2C > ₹2.5L invoice into §5 (B2C Large)', () => {
    const inv = makeInvoice({
      buyerGstin: null,
      sellerStateCode: '29', // KA
      placeOfSupplyStateCode: '07', // DL
      taxableAmountInPaise: 300_000_00n, // ₹3 lakh
      igstAmountInPaise: 54_000_00n,
      documentTotalInPaise: 354_000_00n, // > ₹2.5L
    });
    const r = aggregateGstr1([inv]);
    expect(r.b2cLarge).toHaveLength(1);
    expect(r.b2cLarge[0].placeOfSupplyStateCode).toBe('07');
    expect(r.b2cSmall).toHaveLength(0);
  });

  it('puts an inter-state B2C ≤ ₹2.5L invoice into §7 (B2C Small)', () => {
    const inv = makeInvoice({
      buyerGstin: null,
      sellerStateCode: '29',
      placeOfSupplyStateCode: '07',
      taxableAmountInPaise: 100_000n,
      igstAmountInPaise: 18_000n,
      documentTotalInPaise: 118_000n,
      lines: [
        {
          hsnOrSacCode: '6404',
          uqcCode: 'PCS',
          quantity: 1 as any,
          gstRateBps: 1800,
          taxableAmountInPaise: 100_000n,
          cgstAmountInPaise: 0n,
          sgstAmountInPaise: 0n,
          igstAmountInPaise: 18_000n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 18_000n,
        },
      ],
    });
    const r = aggregateGstr1([inv]);
    expect(r.b2cLarge).toHaveLength(0);
    expect(r.b2cSmall).toHaveLength(1);
    expect(r.b2cSmall[0].gstRateBps).toBe(1800);
    expect(r.b2cSmall[0].placeOfSupplyStateCode).toBe('07');
  });

  it('puts an intra-state B2C invoice into §7 regardless of value', () => {
    const inv = makeInvoice({
      buyerGstin: null,
      sellerStateCode: '29',
      placeOfSupplyStateCode: '29',
      taxableAmountInPaise: 300_000_00n,
      cgstAmountInPaise: 27_000_00n,
      sgstAmountInPaise: 27_000_00n,
      documentTotalInPaise: 354_000_00n,
      lines: [
        {
          hsnOrSacCode: '6404',
          uqcCode: 'PCS',
          quantity: 1 as any,
          gstRateBps: 1800,
          taxableAmountInPaise: 300_000_00n,
          cgstAmountInPaise: 27_000_00n,
          sgstAmountInPaise: 27_000_00n,
          igstAmountInPaise: 0n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 54_000_00n,
        },
      ],
    });
    const r = aggregateGstr1([inv]);
    expect(r.b2cLarge).toHaveLength(0);
    expect(r.b2cSmall).toHaveLength(1);
  });

  it('aggregates B2C Small by (state, rate)', () => {
    const a = makeInvoice({
      documentNumber: 'SM-INV-A',
      buyerGstin: null,
      sellerStateCode: '29',
      placeOfSupplyStateCode: '07',
      taxableAmountInPaise: 50_000n,
      igstAmountInPaise: 9_000n,
      documentTotalInPaise: 59_000n,
      lines: [
        {
          hsnOrSacCode: 'X',
          uqcCode: 'PCS',
          quantity: 1 as any,
          gstRateBps: 1800,
          taxableAmountInPaise: 50_000n,
          cgstAmountInPaise: 0n,
          sgstAmountInPaise: 0n,
          igstAmountInPaise: 9_000n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 9_000n,
        },
      ],
    });
    const b = makeInvoice({
      documentNumber: 'SM-INV-B',
      buyerGstin: null,
      sellerStateCode: '29',
      placeOfSupplyStateCode: '07',
      taxableAmountInPaise: 30_000n,
      igstAmountInPaise: 5_400n,
      documentTotalInPaise: 35_400n,
      lines: [
        {
          hsnOrSacCode: 'Y',
          uqcCode: 'PCS',
          quantity: 1 as any,
          gstRateBps: 1800,
          taxableAmountInPaise: 30_000n,
          cgstAmountInPaise: 0n,
          sgstAmountInPaise: 0n,
          igstAmountInPaise: 5_400n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 5_400n,
        },
      ],
    });
    const r = aggregateGstr1([a, b]);
    expect(r.b2cSmall).toHaveLength(1);
    expect(r.b2cSmall[0].taxableInPaise).toBe(80_000n);
    expect(r.b2cSmall[0].igstInPaise).toBe(14_400n);
  });

  it('puts CREDIT_NOTE into §9B', () => {
    const cn: DocumentForGstr1 = makeInvoice({
      documentNumber: 'SM-CN-000001',
      documentType: 'CREDIT_NOTE',
      buyerGstin: '07AAGCB1234C1Z5',
      placeOfSupplyStateCode: '07',
      originalDocumentNumber: 'SM-INV-000005',
      taxableAmountInPaise: 50_000n,
      igstAmountInPaise: 9_000n,
      documentTotalInPaise: 59_000n,
    });
    const r = aggregateGstr1([cn]);
    expect(r.creditNotes).toHaveLength(1);
    expect(r.creditNotes[0].originalInvoiceNumber).toBe('SM-INV-000005');
    expect(r.creditNotes[0].buyerType).toBe('B2B');
    expect(r.creditNotes[0].taxableReversalInPaise).toBe(50_000n);
  });

  it('aggregates §12 HSN summary across documents', () => {
    const a = makeInvoice({
      documentNumber: 'SM-INV-1',
      taxableAmountInPaise: 100_000n,
      cgstAmountInPaise: 9_000n,
      sgstAmountInPaise: 9_000n,
      documentTotalInPaise: 118_000n,
      lines: [
        {
          hsnOrSacCode: '6404',
          uqcCode: 'PCS',
          quantity: 2 as any,
          gstRateBps: 1800,
          taxableAmountInPaise: 100_000n,
          cgstAmountInPaise: 9_000n,
          sgstAmountInPaise: 9_000n,
          igstAmountInPaise: 0n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 18_000n,
        },
      ],
    });
    const b = makeInvoice({
      documentNumber: 'SM-INV-2',
      taxableAmountInPaise: 50_000n,
      cgstAmountInPaise: 4_500n,
      sgstAmountInPaise: 4_500n,
      documentTotalInPaise: 59_000n,
      lines: [
        {
          hsnOrSacCode: '6404',
          uqcCode: 'PCS',
          quantity: 1 as any,
          gstRateBps: 1800,
          taxableAmountInPaise: 50_000n,
          cgstAmountInPaise: 4_500n,
          sgstAmountInPaise: 4_500n,
          igstAmountInPaise: 0n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 9_000n,
        },
      ],
    });
    const r = aggregateGstr1([a, b]);
    expect(r.hsn).toHaveLength(1);
    expect(r.hsn[0].hsnOrSacCode).toBe('6404');
    expect(r.hsn[0].gstRateBps).toBe(1800);
    expect(r.hsn[0].totalQuantity).toBe(3);
    expect(r.hsn[0].taxableInPaise).toBe(150_000n);
    expect(r.hsn[0].cgstInPaise).toBe(13_500n);
    expect(r.hsn[0].sgstInPaise).toBe(13_500n);
  });

  it('splits HSN by (code, rate) pair', () => {
    const a = makeInvoice({
      lines: [
        {
          hsnOrSacCode: '6404',
          uqcCode: 'PCS',
          quantity: 1 as any,
          gstRateBps: 1800,
          taxableAmountInPaise: 100n,
          cgstAmountInPaise: 9n,
          sgstAmountInPaise: 9n,
          igstAmountInPaise: 0n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 18n,
        },
        {
          hsnOrSacCode: '6404',
          uqcCode: 'PCS',
          quantity: 1 as any,
          gstRateBps: 500, // different rate
          taxableAmountInPaise: 200n,
          cgstAmountInPaise: 5n,
          sgstAmountInPaise: 5n,
          igstAmountInPaise: 0n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 10n,
        },
      ],
    });
    const r = aggregateGstr1([a]);
    expect(r.hsn).toHaveLength(2);
    expect(r.hsn[0].gstRateBps).toBe(500);
    expect(r.hsn[1].gstRateBps).toBe(1800);
  });

  it('counts every document in §13', () => {
    const docs: DocumentForGstr1[] = [
      makeInvoice({ documentType: 'TAX_INVOICE' }),
      makeInvoice({ documentType: 'TAX_INVOICE' }),
      makeInvoice({ documentType: 'CREDIT_NOTE' }),
      makeInvoice({ documentType: 'BILL_OF_SUPPLY' }),
      makeInvoice({ documentType: 'LEGACY_RECEIPT' }),
    ];
    const r = aggregateGstr1(docs);
    const byType = Object.fromEntries(
      r.documentsIssued.map((d) => [d.documentType, d.count]),
    );
    expect(byType.TAX_INVOICE).toBe(2);
    expect(byType.CREDIT_NOTE).toBe(1);
    expect(byType.BILL_OF_SUPPLY).toBe(1);
    expect(byType.LEGACY_RECEIPT).toBe(1);
  });

  it('B2C Large requires inter-state — intra-state > ₹2.5L stays in §7', () => {
    const inv = makeInvoice({
      buyerGstin: null,
      sellerStateCode: '29',
      placeOfSupplyStateCode: '29', // SAME state → not B2C Large
      taxableAmountInPaise: 300_000_00n,
      cgstAmountInPaise: 27_000_00n,
      sgstAmountInPaise: 27_000_00n,
      documentTotalInPaise: 354_000_00n,
    });
    const r = aggregateGstr1([inv]);
    expect(r.b2cLarge).toHaveLength(0);
    expect(r.b2cSmall).toHaveLength(1);
  });

  it('handles missing line metadata (HSN code = null) without crashing', () => {
    const inv = makeInvoice({
      lines: [
        {
          hsnOrSacCode: null,
          uqcCode: null,
          quantity: 1 as any,
          gstRateBps: 1800,
          taxableAmountInPaise: 100n,
          cgstAmountInPaise: 9n,
          sgstAmountInPaise: 9n,
          igstAmountInPaise: 0n,
          cessAmountInPaise: 0n,
          totalTaxAmountInPaise: 18n,
        },
      ],
    });
    const r = aggregateGstr1([inv]);
    // No HSN → not bucketed into §12.
    expect(r.hsn).toHaveLength(0);
  });
});
