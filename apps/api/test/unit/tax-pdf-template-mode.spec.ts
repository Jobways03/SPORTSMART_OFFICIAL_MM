import 'reflect-metadata';
import {
  renderHtmlForDocument,
  type TemplateInput,
} from '../../src/modules/tax/domain/tax-document-html-template';

// Phase 23 — template DRAFT banner is mode-aware. Re-uses the
// fixture from tax-pdf-template.spec.ts via a local copy so this
// suite stays focused on the mode toggle.

function makeDoc(): TemplateInput['document'] {
  return {
    documentNumber: 'SM-INV-000001',
    documentType: 'TAX_INVOICE',
    financialYear: '2026-27',
    invoiceType: 'B2C',
    generatedAt: new Date(Date.UTC(2026, 3, 15)),
    supplierGstin: '29ABCDE1234F1Z5',
    sellerLegalName: 'Acme Sports',
    sellerAddressJson: null,
    sellerStateCode: '29',
    buyerGstin: null,
    buyerLegalName: 'Priya Sharma',
    billingAddressJson: null,
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
    amountInWords: null,
    currencyCode: 'INR',
    paymentMode: null,
    originalDocumentNumber: null,
    reason: null,
    // Phase 22 e-invoice metadata — NOT_APPLICABLE for this B2C sample
    // (never IRP-signed), so the template skips the IRN/QR block.
    irn: null,
    ackNo: null,
    ackDate: null,
    qrCodeUrl: null,
    einvoiceStatus: 'NOT_APPLICABLE',
  };
}

const lines: TemplateInput['lines'] = [
  {
    lineNumber: 1,
    productName: 'Cricket Bat',
    sku: null,
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

describe('renderHtmlForDocument — DRAFT banner per mode', () => {
  it('mode unspecified (default) → DRAFT banner is rendered', () => {
    const html = renderHtmlForDocument({ document: makeDoc(), lines });
    expect(html).toMatch(/<strong>DRAFT<\/strong>/);
    expect(html).toMatch(/pending CA sign-off/);
  });

  it('mode=OFF → DRAFT banner is rendered', () => {
    const html = renderHtmlForDocument({
      mode: 'OFF',
      document: makeDoc(),
      lines,
    });
    expect(html).toMatch(/<strong>DRAFT<\/strong>/);
  });

  it('mode=AUDIT → DRAFT banner is rendered (audit ≠ CA sign-off)', () => {
    const html = renderHtmlForDocument({
      mode: 'AUDIT',
      document: makeDoc(),
      lines,
    });
    expect(html).toMatch(/<strong>DRAFT<\/strong>/);
  });

  it('mode=STRICT → DRAFT banner is suppressed', () => {
    const html = renderHtmlForDocument({
      mode: 'STRICT',
      document: makeDoc(),
      lines,
    });
    expect(html).not.toMatch(/<strong>DRAFT<\/strong>/);
    expect(html).not.toMatch(/pending CA sign-off/);
  });

  it('STRICT mode keeps all the substantive content (heading + totals)', () => {
    const html = renderHtmlForDocument({
      mode: 'STRICT',
      document: makeDoc(),
      lines,
    });
    expect(html).toMatch(/<h1>Tax Invoice<\/h1>/);
    expect(html).toMatch(/1,180\.00/);
  });
});
