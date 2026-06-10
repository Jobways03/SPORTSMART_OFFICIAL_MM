import 'reflect-metadata';
import {
  renderHtmlForDocument,
  type TemplateInput,
} from '../../src/modules/tax/domain/tax-document-html-template';

// Phase 19 GST — HTML template tests.
//
// All templates are pure functions: same input → same output. We
// assert: (a) escaping is applied, (b) document type → correct
// template, (c) the DRAFT banner appears, (d) money rendering uses
// Indian grouping + paise→rupees.

function makeDoc(overrides: Partial<TemplateInput['document']> = {}): TemplateInput['document'] {
  return {
    documentNumber: 'SM-INV-000001',
    documentType: 'TAX_INVOICE',
    financialYear: '2026-27',
    invoiceType: 'B2C',
    generatedAt: new Date(Date.UTC(2026, 3, 15, 8, 30, 0)),
    supplierGstin: '29ABCDE1234F1Z5',
    sellerLegalName: 'Acme Sports Pvt Ltd',
    sellerAddressJson: {
      line1: '1 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      country: 'India',
    } as any,
    sellerStateCode: '29',
    buyerGstin: null,
    buyerLegalName: 'Priya Sharma',
    billingAddressJson: {
      line1: '5 Park Lane',
      city: 'Delhi',
      pincode: '110001',
    } as any,
    shippingAddressJson: null,
    placeOfSupplyStateCode: '07',
    reverseChargeApplicable: false,
    reverseChargeReason: null,
    taxableAmountInPaise: 1_000_00n,
    cgstAmountInPaise: 0n,
    sgstAmountInPaise: 0n,
    igstAmountInPaise: 180_00n,
    totalTaxAmountInPaise: 180_00n,
    cessAmountInPaise: 0n,
    roundOffAmountInPaise: 0n,
    documentTotalInPaise: 1_180_00n,
    amountInWords: 'Rupees One Thousand One Hundred Eighty Only',
    currencyCode: 'INR',
    paymentMode: 'COD',
    originalDocumentNumber: null,
    reason: null,
    // Phase 22 e-invoice metadata — NOT_APPLICABLE for this B2C sample
    // (never IRP-signed), so the template skips the IRN/QR block.
    irn: null,
    ackNo: null,
    ackDate: null,
    qrCodeUrl: null,
    einvoiceStatus: 'NOT_APPLICABLE',
    ...overrides,
  };
}

function makeLines(): TemplateInput['lines'] {
  return [
    {
      lineNumber: 1,
      productName: 'Cricket Bat',
      sku: 'BAT-001',
      hsnOrSacCode: '6404',
      uqcCode: 'PCS',
      quantity: 1 as any,
      unitPriceInPaise: 1_000_00n,
      discountAmountInPaise: 0n,
      taxableAmountInPaise: 1_000_00n,
      gstRateBps: 1800,
      cgstAmountInPaise: 0n,
      sgstAmountInPaise: 0n,
      igstAmountInPaise: 180_00n,
      cessAmountInPaise: 0n,
      lineTotalInPaise: 1_180_00n,
    },
  ];
}

describe('renderHtmlForDocument — TAX_INVOICE', () => {
  it('includes the DRAFT banner on every render', () => {
    const html = renderHtmlForDocument({
      document: makeDoc(),
      lines: makeLines(),
    });
    expect(html).toMatch(/<strong>DRAFT<\/strong>/);
    expect(html).toMatch(/pending CA sign-off/);
  });

  it('shows "Tax Invoice" heading', () => {
    const html = renderHtmlForDocument({
      document: makeDoc(),
      lines: makeLines(),
    });
    expect(html).toMatch(/<h1>Tax Invoice<\/h1>/);
  });

  it('renders money with Indian numbering (lakh)', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({
        taxableAmountInPaise: 1_50_000_00n, // ₹1,50,000
        documentTotalInPaise: 1_77_000_00n,
      }),
      lines: makeLines(),
    });
    expect(html).toMatch(/1,50,000\.00/);
    expect(html).toMatch(/1,77,000\.00/);
  });

  it('shows reverse-charge banner when flagged', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({
        reverseChargeApplicable: true,
        reverseChargeReason: 'B2B services per Section 9(3)',
      }),
      lines: makeLines(),
    });
    expect(html).toMatch(/Reverse Charge/);
    expect(html).toMatch(/B2B services per Section 9\(3\)/);
  });

  it('escapes HTML in interpolated values', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({
        sellerLegalName: '<script>alert(1)</script>',
        buyerLegalName: 'Acme & Co.',
      }),
      lines: makeLines(),
    });
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
    expect(html).toMatch(/Acme &amp; Co\./);
  });

  it('renders CGST/SGST columns for tax invoices', () => {
    const html = renderHtmlForDocument({
      document: makeDoc(),
      lines: makeLines(),
    });
    expect(html).toMatch(/CGST/);
    expect(html).toMatch(/SGST/);
    expect(html).toMatch(/IGST/);
  });
});

describe('renderHtmlForDocument — BILL_OF_SUPPLY', () => {
  it('shows "Bill of Supply" heading + no GST tax columns', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({ documentType: 'BILL_OF_SUPPLY' }),
      lines: makeLines(),
    });
    expect(html).toMatch(/<h1>Bill of Supply<\/h1>/);
    expect(html).toMatch(/composition \/ exempt/);
    // Tax columns absent
    expect(html).not.toMatch(/<th class="text-right">CGST/);
  });
});

describe('renderHtmlForDocument — CREDIT_NOTE', () => {
  it('shows "Credit Note" heading + original document reference', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({
        documentType: 'CREDIT_NOTE',
        documentNumber: 'SM-CN-000005',
        originalDocumentNumber: 'SM-INV-000007',
        reason: 'Item returned',
      }),
      lines: makeLines(),
    });
    expect(html).toMatch(/<h1>Credit Note<\/h1>/);
    expect(html).toMatch(/SM-INV-000007/);
    expect(html).toMatch(/Item returned/);
    expect(html).toMatch(/Section 34/);
  });
});

describe('renderHtmlForDocument — LEGACY_RECEIPT', () => {
  it('shows non-tax banner', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({ documentType: 'LEGACY_RECEIPT' }),
      lines: makeLines(),
    });
    expect(html).toMatch(/<h1>Legacy Order Receipt<\/h1>/);
    expect(html).toMatch(/NON-TAX RECEIPT/);
  });
});

describe('renderHtmlForDocument — INVOICE_CUM_BILL_OF_SUPPLY', () => {
  it('shows "Invoice-cum-Bill of Supply" heading', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({ documentType: 'INVOICE_CUM_BILL_OF_SUPPLY' }),
      lines: makeLines(),
    });
    expect(html).toMatch(/Invoice-cum-Bill of Supply/);
  });
});

describe('renderHtmlForDocument — unknown type', () => {
  it('throws on unhandled documentType', () => {
    expect(() =>
      renderHtmlForDocument({
        document: makeDoc({ documentType: 'GARBAGE' as any }),
        lines: makeLines(),
      }),
    ).toThrow(/No template registered/);
  });
});

describe('renderHtmlForDocument — date formatting', () => {
  it('formats date in IST DD-MM-YYYY', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({
        // 15 Apr 2026 08:30 UTC = 15 Apr 2026 14:00 IST → still 15-04-2026.
        generatedAt: new Date(Date.UTC(2026, 3, 15, 8, 30, 0)),
      }),
      lines: makeLines(),
    });
    expect(html).toMatch(/15-04-2026/);
  });

  it('handles IST-day rollover near midnight UTC', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({
        // 31 Mar 2026 19:00 UTC = 1 Apr 2026 00:30 IST.
        generatedAt: new Date(Date.UTC(2026, 2, 31, 19, 0, 0)),
      }),
      lines: makeLines(),
    });
    expect(html).toMatch(/01-04-2026/);
  });
});

describe('renderHtmlForDocument — negative amounts', () => {
  it('renders negative paise in parentheses (accounting style)', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({ roundOffAmountInPaise: -5n }),
      lines: makeLines(),
    });
    expect(html).toMatch(/\(0\.05\)/);
  });
});

describe('renderHtmlForDocument — seller invoice sections', () => {
  it('renders the marketplace order reference when present', () => {
    const html = renderHtmlForDocument({
      document: makeDoc({ masterOrderId: 'ORD-123', subOrderId: 'SUB-456' }),
      lines: makeLines(),
    });
    expect(html).toMatch(/Marketplace Order ID/);
    expect(html).toMatch(/ORD-123/);
    expect(html).toMatch(/SUB-456/);
  });

  it('carries the "on behalf of the seller" declaration', () => {
    const html = renderHtmlForDocument({ document: makeDoc(), lines: makeLines() });
    expect(html).toMatch(
      /Invoice generated by Sportsmart\.com on behalf of the seller/,
    );
  });

  it('shows the Item Details heading and a per-line discount column', () => {
    const html = renderHtmlForDocument({
      document: makeDoc(),
      lines: [
        {
          ...makeLines()[0],
          discountAmountInPaise: 50_00n,
          taxableAmountInPaise: 950_00n,
        },
      ],
    });
    expect(html).toMatch(/Item Details/);
    expect(html).toMatch(/Discount/);
    expect(html).toMatch(/50\.00/);
  });

  it('splits non-product (charge) lines into an Other Charges section', () => {
    const html = renderHtmlForDocument({
      document: makeDoc(),
      lines: [
        makeLines()[0],
        {
          lineNumber: 2,
          productName: 'Shipping',
          sku: null,
          hsnOrSacCode: '9968',
          uqcCode: 'OTH',
          quantity: 1 as any,
          unitPriceInPaise: 50_00n,
          discountAmountInPaise: 0n,
          taxableAmountInPaise: 50_00n,
          gstRateBps: 1800,
          cgstAmountInPaise: 0n,
          sgstAmountInPaise: 0n,
          igstAmountInPaise: 9_00n,
          cessAmountInPaise: 0n,
          lineTotalInPaise: 59_00n,
          lineType: 'SHIPPING',
        },
      ],
    });
    expect(html).toMatch(/Other Charges/);
    expect(html).toMatch(/Shipping &amp; Handling/);
  });
});
