// Marketplace commission tax invoice (SAC 9985) renderer coverage.

import {
  renderCommissionInvoiceHtml,
  type CommissionInvoiceTemplateInput,
} from './tax-document-html-template';

function baseInput(
  overrides: Partial<CommissionInvoiceTemplateInput> = {},
): CommissionInvoiceTemplateInput {
  return {
    mode: 'OFF',
    invoiceNumber: 'SM-MKTCOM-000001',
    invoiceDate: new Date('2026-06-08T10:00:00.000Z'),
    financialYear: '2026-27',
    filingPeriod: '2026-06',
    sacCode: '9985',
    gstRateBps: 1800,
    splitType: 'IGST',

    marketplaceLegalName: 'Sportsmart Marketplace Pvt Ltd',
    marketplaceGstin: '36AAAAA0000A1Z5',
    marketplacePan: 'AAAAA0000A',
    marketplaceStateCode: '36',
    marketplaceAddressJson: { line1: 'Office', city: 'Hyderabad', state: 'Telangana' },

    sellerLegalName: 'Vansh Sports',
    sellerShopName: 'Vansh Sports Shop',
    sellerGstin: '29PQRST5678K1ZY',
    sellerPan: 'PQRST5678K',
    sellerIsB2c: false,
    sellerStateCode: '29',
    sellerAddressJson: { line1: 'Shop 1', city: 'Bengaluru', state: 'Karnataka' },
    placeOfSupplyStateCode: '29',

    settlementId: 'b234a0c8-0000-0000-0000-000000000000',
    settlementStatementRef: 'SM-STMT-B234A0C8',
    cyclePeriodStart: new Date('2026-05-10T00:00:00.000Z'),
    cyclePeriodEnd: new Date('2026-05-11T00:00:00.000Z'),
    totalOrders: 8,
    totalItems: 10,
    grossGmvInPaise: 1869000n, // ₹18,690 GMV → effective rate vs commission

    // ₹359.80 commission, 18% IGST = ₹64.76, total ₹424.56.
    commissionTaxableInPaise: 35980n,
    cgstInPaise: 0n,
    sgstInPaise: 0n,
    igstInPaise: 6476n,
    totalGstInPaise: 6476n,
    irn: null,
    ...overrides,
  };
}

describe('renderCommissionInvoiceHtml', () => {
  it('renders the invoice number, SAC, both parties (with PAN) and split', () => {
    const html = renderCommissionInvoiceHtml(baseInput());
    expect(html).toContain('SM-MKTCOM-000001');
    expect(html).toContain('9985');
    expect(html).toContain('Inter-state (IGST)');
    expect(html).toContain('36AAAAA0000A1Z5'); // marketplace GSTIN
    expect(html).toContain('29PQRST5678K1ZY'); // seller GSTIN
    expect(html).toContain('Vansh Sports');
    expect(html).toContain('AAAAA0000A'); // marketplace PAN
    expect(html).toContain('PQRST5678K'); // seller PAN
  });

  it('shows the settlement context (ID, cycle, statement ref, orders)', () => {
    const html = renderCommissionInvoiceHtml(baseInput());
    expect(html).toContain('b234a0c8-0000-0000-0000-000000000000');
    expect(html).toContain('SM-STMT-B234A0C8');
    expect(html).toMatch(/10-05-2026.*11-05-2026/s); // cycle period
    expect(html).toMatch(/Total Orders/);
  });

  it('computes taxable, tax and grand total (taxable + GST) correctly', () => {
    const html = renderCommissionInvoiceHtml(baseInput());
    expect(html).toContain('359.80'); // taxable
    expect(html).toContain('64.76'); // IGST
    expect(html).toContain('424.56'); // grand total = 359.80 + 64.76
  });

  it('labels an unregistered seller as B2C and hides the GSTIN', () => {
    const html = renderCommissionInvoiceHtml(
      baseInput({ sellerGstin: null, sellerIsB2c: true }),
    );
    expect(html).toContain('Unregistered (B2C)');
  });

  it('shows the intra-state split label for a CGST/SGST invoice', () => {
    const html = renderCommissionInvoiceHtml(
      baseInput({
        splitType: 'CGST_SGST',
        cgstInPaise: 3238n,
        sgstInPaise: 3238n,
        igstInPaise: 0n,
        totalGstInPaise: 6476n,
      }),
    );
    expect(html).toContain('Intra-state (CGST + SGST)');
  });

  it('renders an Adjustments & Recoveries section when present', () => {
    const html = renderCommissionInvoiceHtml(
      baseInput({
        adjustments: [
          { label: 'SLA Breach Penalty', reason: 'Late dispatch', amountInPaise: 5000n },
        ],
      }),
    );
    expect(html).toContain('Adjustments &amp; Recoveries');
    expect(html).toContain('SLA Breach Penalty');
    expect(html).toContain('Late dispatch');
  });

  it('carries the "separate from the seller-to-customer tax invoice" note', () => {
    const html = renderCommissionInvoiceHtml(baseInput());
    expect(html).toContain(
      'separate from the seller-to-customer tax invoice',
    );
    expect(html).toContain(
      'marketplace services provided by Sportsmart.com to the seller',
    );
  });

  it('escapes HTML in interpolated values (no injection via seller name)', () => {
    const html = renderCommissionInvoiceHtml(
      baseInput({ sellerLegalName: '<script>alert(1)</script>' }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('suppresses the DRAFT banner in STRICT mode', () => {
    expect(renderCommissionInvoiceHtml(baseInput({ mode: 'OFF' }))).toContain(
      'DRAFT',
    );
    expect(
      renderCommissionInvoiceHtml(baseInput({ mode: 'STRICT' })),
    ).not.toContain('DRAFT');
  });
});
