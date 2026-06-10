// Settlement / payout statement renderer coverage.

import {
  renderSettlementStatementHtml,
  type SettlementStatementTemplateInput,
} from './tax-document-html-template';

// Mirrors the screenshot: Gross ₹18,690 − Commission ₹3,738 →
// Settlement ₹7,654; less Commission GST ₹672.84 and TDS ₹569.60
// (TCS 0) → Net ₹6,411.56.
function baseInput(
  overrides: Partial<SettlementStatementTemplateInput> = {},
): SettlementStatementTemplateInput {
  return {
    mode: 'OFF',
    statementRef: 'SM-STMT-ABCD1234',
    statementDate: new Date('2026-06-09T10:00:00.000Z'),
    periodStart: new Date('2026-05-10T00:00:00.000Z'),
    periodEnd: new Date('2026-05-11T00:00:00.000Z'),
    status: 'PAID',
    totalOrders: 8,
    totalItems: 10,
    marketplaceLegalName: 'Sportsmart Marketplace Pvt Ltd',
    marketplaceGstin: '36AAAAA0000A1Z5',
    marketplaceStateCode: '36',
    marketplaceAddressJson: { line1: 'Office', city: 'Hyderabad', state: 'Telangana' },
    sellerLegalName: 'Shiva Sports Pvt Ltd',
    sellerShopName: 'Shiva Sports',
    sellerGstin: '27ABCPK1234M1ZQ',
    sellerStateCode: '27',
    sellerAddressJson: { line1: '12 MG Road', city: 'Mumbai', state: 'Maharashtra' },
    grossGmvInPaise: 1869000n,
    commissionInPaise: 373800n,
    settlementAmountInPaise: 765400n,
    commissionGstInPaise: 67284n,
    commissionGstSplitType: 'IGST',
    cgstOnCommissionInPaise: 0n,
    sgstOnCommissionInPaise: 0n,
    igstOnCommissionInPaise: 67284n,
    commissionGstRateBps: 1800,
    tcsInPaise: 0n,
    tcsRateBps: 100,
    tdsInPaise: 56960n,
    tdsRateBps: 500,
    netPayoutInPaise: 641156n,
    utrReference: 'Test3349348934',
    paidAt: new Date('2026-06-09T10:00:00.000Z'),
    paymentMethod: 'NEFT',
    commissionInvoiceNumber: 'SM-MKTCOM-000004',
    ...overrides,
  };
}

describe('renderSettlementStatementHtml', () => {
  it('renders the full payout breakdown with matching figures', () => {
    const html = renderSettlementStatementHtml(baseInput());
    expect(html).toContain('Settlement Statement');
    expect(html).toContain('18,690.00'); // gross GMV
    expect(html).toContain('3,738.00'); // commission
    expect(html).toContain('7,654.00'); // settlement amount
    expect(html).toContain('672.84'); // commission GST
    expect(html).toContain('569.60'); // TDS
    expect(html).toContain('6,411.56'); // net payout
  });

  it('is explicitly NOT a tax invoice and cross-references the commission invoice', () => {
    const html = renderSettlementStatementHtml(baseInput());
    expect(html).toContain('NOT a GST tax invoice');
    expect(html).toContain('SM-MKTCOM-000004');
  });

  it('omits a deduction line when its amount is zero', () => {
    // TCS is 0 in the base input → no TCS deduction row. (The footer note
    // still mentions "Section 52", so assert on the row label "TCS @".)
    expect(renderSettlementStatementHtml(baseInput())).not.toContain('TCS @');
    // ...but the row appears when non-zero.
    expect(
      renderSettlementStatementHtml(baseInput({ tcsInPaise: 18690n })),
    ).toContain('TCS @');
  });

  it('shows the UTR for a PAID settlement and a pending notice otherwise', () => {
    expect(renderSettlementStatementHtml(baseInput())).toContain('Test3349348934');
    const pending = renderSettlementStatementHtml(
      baseInput({ status: 'APPROVED', utrReference: null, paidAt: null }),
    );
    expect(pending).toContain('not yet disbursed');
  });

  it('escapes HTML in interpolated values', () => {
    const html = renderSettlementStatementHtml(
      baseInput({ sellerLegalName: '<script>alert(1)</script>' }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders an Orders table when order lines are supplied', () => {
    const html = renderSettlementStatementHtml(
      baseInput({
        orders: [
          {
            orderNumber: 'SM-ORD-9001',
            date: new Date('2026-05-10T10:00:00.000Z'),
            productTitle: 'Cricket Bat',
            quantity: 1,
            grossInPaise: 1869000n,
            commissionInPaise: 373800n,
            status: 'SETTLED',
          },
        ],
        returnedOrderCount: 0,
      }),
    );
    expect(html).toContain('Orders in this Settlement');
    expect(html).toContain('SM-ORD-9001');
    expect(html).toContain('Cricket Bat');
  });

  it('shows seller PAN, seller code, payout date and bank details', () => {
    const html = renderSettlementStatementHtml(
      baseInput({
        sellerPan: '••••1234M',
        sellerCode: 'b234a0c8',
        payoutDate: new Date('2026-06-09T10:00:00.000Z'),
        bankAccountHolder: 'Shiva Sports Pvt Ltd',
        bankName: 'HDFC Bank',
        bankIfsc: 'HDFC0001234',
        bankAccountLast4: '6789',
      }),
    );
    expect(html).toContain('••••1234M'); // PAN
    expect(html).toContain('Seller Code');
    expect(html).toMatch(/Payout Date/);
    expect(html).toContain('HDFC Bank');
    expect(html).toContain('IFSC HDFC0001234');
    expect(html).toContain('A/C ••••6789');
  });

  it('renders an Adjustments section when present', () => {
    const html = renderSettlementStatementHtml(
      baseInput({
        adjustments: [
          { label: 'Commission Clawback', reason: 'Return reversal', amountInPaise: 12000n },
        ],
      }),
    );
    expect(html).toContain('Adjustments &amp; Recoveries');
    expect(html).toContain('Commission Clawback');
  });
});
