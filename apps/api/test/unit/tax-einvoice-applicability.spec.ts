import 'reflect-metadata';
import {
  decideEInvoiceApplicability,
  DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE,
} from '../../src/modules/tax/domain/einvoice-applicability';

// Phase 22 GST — E-invoice applicability pure-function tests.
//
// CBIC contract (Aug-2023 onward):
//   - Document type must be invoice-like (TAX_INVOICE / INVOICE_CUM_BoS /
//     CREDIT_NOTE / DEBIT_NOTE).
//   - Recipient must have a GSTIN (B2B).
//   - Supplier turnover > ₹5 crore OR explicit opt-in.

const FIVE_CRORE = DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE;

function input(o: any = {}) {
  return {
    documentType: 'TAX_INVOICE',
    documentStatus: 'GENERATED',
    buyerGstin: '07AAGCB1234C1Z5',
    supplierAggregateTurnoverInPaise: FIVE_CRORE + 1n, // just over
    supplierEinvoiceOptedIn: false,
    ...o,
  };
}

describe('DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE', () => {
  it('is ₹5 crore', () => {
    // 5_00_00_000_00 paise = 5 crore rupees.
    expect(DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE).toBe(5_00_00_000_00n);
  });
});

describe('decideEInvoiceApplicability — document gate', () => {
  it('TAX_INVOICE → applicable when all gates pass', () => {
    expect(decideEInvoiceApplicability(input()).applicable).toBe(true);
  });

  it('INVOICE_CUM_BILL_OF_SUPPLY → applicable', () => {
    expect(
      decideEInvoiceApplicability(
        input({ documentType: 'INVOICE_CUM_BILL_OF_SUPPLY' }),
      ).applicable,
    ).toBe(true);
  });

  it('CREDIT_NOTE → applicable', () => {
    expect(
      decideEInvoiceApplicability(
        input({ documentType: 'CREDIT_NOTE' }),
      ).applicable,
    ).toBe(true);
  });

  it('DEBIT_NOTE → applicable', () => {
    expect(
      decideEInvoiceApplicability(
        input({ documentType: 'DEBIT_NOTE' }),
      ).applicable,
    ).toBe(true);
  });

  it('BILL_OF_SUPPLY → not applicable (composition / exempt supplier)', () => {
    const d = decideEInvoiceApplicability(
      input({ documentType: 'BILL_OF_SUPPLY' }),
    );
    expect(d.applicable).toBe(false);
    expect(d.reason).toMatch(/Bill of Supply/);
  });

  it('LEGACY_RECEIPT → not applicable (non-tax record)', () => {
    expect(
      decideEInvoiceApplicability(
        input({ documentType: 'LEGACY_RECEIPT' }),
      ).applicable,
    ).toBe(false);
  });

  it('VOIDED_DRAFT → not applicable (not legally issued)', () => {
    expect(
      decideEInvoiceApplicability(
        input({ documentStatus: 'VOIDED_DRAFT' }),
      ).applicable,
    ).toBe(false);
  });

  it('SUPERSEDED → not applicable (not legally issued)', () => {
    expect(
      decideEInvoiceApplicability(
        input({ documentStatus: 'SUPERSEDED' }),
      ).applicable,
    ).toBe(false);
  });
});

describe('decideEInvoiceApplicability — recipient gate', () => {
  it('B2C (no buyer GSTIN) → not applicable', () => {
    const d = decideEInvoiceApplicability(input({ buyerGstin: null }));
    expect(d.applicable).toBe(false);
    expect(d.reason).toMatch(/B2C/);
  });
});

describe('decideEInvoiceApplicability — turnover gate', () => {
  it('above default ₹5 crore threshold → applicable', () => {
    const d = decideEInvoiceApplicability(
      input({ supplierAggregateTurnoverInPaise: FIVE_CRORE + 1n }),
    );
    expect(d.applicable).toBe(true);
    expect(d.reason).toMatch(/threshold/);
  });

  it('exactly at threshold → not applicable (CBIC uses strict >)', () => {
    expect(
      decideEInvoiceApplicability(
        input({ supplierAggregateTurnoverInPaise: FIVE_CRORE }),
      ).applicable,
    ).toBe(false);
  });

  it('below threshold + not opted in → not applicable', () => {
    const d = decideEInvoiceApplicability(
      input({
        supplierAggregateTurnoverInPaise: 1_00_00_000_00n, // ₹1 crore
        supplierEinvoiceOptedIn: false,
      }),
    );
    expect(d.applicable).toBe(false);
    expect(d.reason).toMatch(/below the/);
  });

  it('below threshold + opted in → applicable', () => {
    const d = decideEInvoiceApplicability(
      input({
        supplierAggregateTurnoverInPaise: 1_00_00_000_00n,
        supplierEinvoiceOptedIn: true,
      }),
    );
    expect(d.applicable).toBe(true);
    expect(d.reason).toMatch(/opted in/);
  });

  it('honours a custom threshold override', () => {
    // Lower the gate to ₹1 crore — ₹2 crore supplier now applicable.
    const d = decideEInvoiceApplicability(
      input({
        supplierAggregateTurnoverInPaise: 2_00_00_000_00n,
        turnoverThresholdInPaise: 1_00_00_000_00n,
      }),
    );
    expect(d.applicable).toBe(true);
  });
});

describe('decideEInvoiceApplicability — composite cases', () => {
  it('B2B + below threshold + not opted in → not applicable', () => {
    const d = decideEInvoiceApplicability(
      input({
        buyerGstin: '07AAGCB1234C1Z5',
        supplierAggregateTurnoverInPaise: 0n,
        supplierEinvoiceOptedIn: false,
      }),
    );
    expect(d.applicable).toBe(false);
    expect(d.reason).toMatch(/below the/);
  });

  it('B2B + opted in (any turnover) → applicable', () => {
    const d = decideEInvoiceApplicability(
      input({
        buyerGstin: '07AAGCB1234C1Z5',
        supplierAggregateTurnoverInPaise: 0n,
        supplierEinvoiceOptedIn: true,
      }),
    );
    expect(d.applicable).toBe(true);
  });

  it('B2C + above threshold → not applicable (B2C trumps turnover)', () => {
    const d = decideEInvoiceApplicability(
      input({
        buyerGstin: null,
        supplierAggregateTurnoverInPaise: FIVE_CRORE * 10n,
      }),
    );
    expect(d.applicable).toBe(false);
    expect(d.reason).toMatch(/B2C/);
  });
});
