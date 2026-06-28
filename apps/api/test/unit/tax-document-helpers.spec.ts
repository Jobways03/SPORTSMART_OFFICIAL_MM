import 'reflect-metadata';
import {
  rupeesToWords,
  paiseToInvoiceWords,
} from '../../src/modules/tax/domain/amount-in-words';
import {
  pickDocumentType,
} from '../../src/modules/tax/domain/document-type-picker';
import {
  computeInvoiceRoundOff,
} from '../../src/modules/tax/domain/round-off';

describe('rupeesToWords', () => {
  it('zero', () => {
    expect(rupeesToWords(0)).toBe('Zero');
  });
  it('single digits', () => {
    expect(rupeesToWords(7)).toBe('Seven');
    expect(rupeesToWords(11)).toBe('Eleven');
    expect(rupeesToWords(19)).toBe('Nineteen');
  });
  it('tens', () => {
    expect(rupeesToWords(20)).toBe('Twenty');
    expect(rupeesToWords(42)).toBe('Forty Two');
    expect(rupeesToWords(99)).toBe('Ninety Nine');
  });
  it('hundreds', () => {
    expect(rupeesToWords(100)).toBe('One Hundred');
    expect(rupeesToWords(101)).toBe('One Hundred One');
    expect(rupeesToWords(999)).toBe('Nine Hundred Ninety Nine');
  });
  it('thousands (Indian system, not Western)', () => {
    expect(rupeesToWords(1_000)).toBe('One Thousand');
    expect(rupeesToWords(1_234)).toBe('One Thousand Two Hundred Thirty Four');
    expect(rupeesToWords(99_999)).toBe('Ninety Nine Thousand Nine Hundred Ninety Nine');
  });
  it('lakhs', () => {
    expect(rupeesToWords(100_000)).toBe('One Lakh');
    expect(rupeesToWords(1_23_456)).toBe('One Lakh Twenty Three Thousand Four Hundred Fifty Six');
  });
  it('crores', () => {
    expect(rupeesToWords(1_00_00_000)).toBe('One Crore');
    expect(rupeesToWords(12_34_56_789)).toBe(
      'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine',
    );
  });
  it('rejects negative + non-integer', () => {
    expect(() => rupeesToWords(-1)).toThrow();
    expect(() => rupeesToWords(1.5)).toThrow();
  });
});

describe('paiseToInvoiceWords', () => {
  it('₹0', () => {
    expect(paiseToInvoiceWords(0n)).toBe('Indian Rupees Zero Only');
  });
  it('whole rupees', () => {
    expect(paiseToInvoiceWords(118_00n)).toBe('Indian Rupees One Hundred Eighteen Only');
  });
  it('rupees + paise', () => {
    expect(paiseToInvoiceWords(1234_56n)).toBe(
      'Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only',
    );
  });
  it('zero rupees, non-zero paise', () => {
    expect(paiseToInvoiceWords(50n)).toBe('Indian Rupees Zero and Fifty Paise Only');
  });
  it('large value with lakh', () => {
    // ₹1,23,456.78 → "One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only"
    expect(paiseToInvoiceWords(1_23_456_78n)).toBe(
      'Indian Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only',
    );
  });
  it('rejects negative BigInt', () => {
    expect(() => paiseToInvoiceWords(-1n)).toThrow();
  });
});

describe('pickDocumentType', () => {
  it('REGULAR + all taxable → TAX_INVOICE', () => {
    const r = pickDocumentType({
      sellerRegistrationType: 'REGULAR',
      hasTaxableLines: true,
      hasExemptLines: false,
    });
    expect(r.documentType).toBe('TAX_INVOICE');
  });
  it('COMPOSITION → BILL_OF_SUPPLY (regardless of supply mix)', () => {
    const r = pickDocumentType({
      sellerRegistrationType: 'COMPOSITION',
      hasTaxableLines: true,
      hasExemptLines: true,
    });
    expect(r.documentType).toBe('BILL_OF_SUPPLY');
    expect(r.reason).toMatch(/Composition/);
  });
  it('UNREGISTERED → BILL_OF_SUPPLY', () => {
    const r = pickDocumentType({
      sellerRegistrationType: 'UNREGISTERED',
      hasTaxableLines: true,
      hasExemptLines: false,
    });
    expect(r.documentType).toBe('BILL_OF_SUPPLY');
  });
  it('REGULAR + all exempt → BILL_OF_SUPPLY', () => {
    const r = pickDocumentType({
      sellerRegistrationType: 'REGULAR',
      hasTaxableLines: false,
      hasExemptLines: true,
    });
    expect(r.documentType).toBe('BILL_OF_SUPPLY');
  });
  it('REGULAR + mixed taxable + exempt → INVOICE_CUM_BILL_OF_SUPPLY', () => {
    const r = pickDocumentType({
      sellerRegistrationType: 'REGULAR',
      hasTaxableLines: true,
      hasExemptLines: true,
    });
    expect(r.documentType).toBe('INVOICE_CUM_BILL_OF_SUPPLY');
    expect(r.reason).toMatch(/Mixed/);
  });
  it('null registration → defaults to REGULAR (platform supplies)', () => {
    const r = pickDocumentType({
      sellerRegistrationType: null,
      hasTaxableLines: true,
      hasExemptLines: false,
    });
    expect(r.documentType).toBe('TAX_INVOICE');
  });
});

describe('computeInvoiceRoundOff', () => {
  // Policy (2026-06): no whole-rupee round-off — invoices carry the EXACT
  // 2-decimal total. computeInvoiceRoundOff is now a pass-through: roundOff is
  // always 0 and the rounded total equals the raw paise total verbatim, so the
  // printed grand total matches the exact paise amount the customer is charged.
  it('exact rupee — no round-off', () => {
    const r = computeInvoiceRoundOff(118_00n);
    expect(r.roundOffInPaise).toBe(0n);
    expect(r.roundedAmountInPaise).toBe(118_00n);
  });
  it('preserves paise — never rounds up', () => {
    const r = computeInvoiceRoundOff(1234_67n);
    expect(r.roundedAmountInPaise).toBe(1234_67n);
    expect(r.roundOffInPaise).toBe(0n);
  });
  it('preserves paise — never rounds down', () => {
    const r = computeInvoiceRoundOff(1234_34n);
    expect(r.roundedAmountInPaise).toBe(1234_34n);
    expect(r.roundOffInPaise).toBe(0n);
  });
  it('preserves exactly-50-paise totals', () => {
    const r = computeInvoiceRoundOff(100_50n);
    expect(r.roundedAmountInPaise).toBe(100_50n);
    expect(r.roundOffInPaise).toBe(0n);
  });
  it('passes negative (credit-note) totals through unchanged', () => {
    const r = computeInvoiceRoundOff(-1234_34n);
    expect(r.roundedAmountInPaise).toBe(-1234_34n);
    expect(r.roundOffInPaise).toBe(0n);
  });
});
