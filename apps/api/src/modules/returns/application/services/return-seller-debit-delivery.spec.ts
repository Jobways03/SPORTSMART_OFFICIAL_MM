// Coverage for the seller-fault return debit: product value (Option A) +
// reverse-logistics delivery charge.
//
// The key behaviours:
//   • product + delivery are combined into ONE SellerDebit (the table has a
//     UNIQUE (source_type, source_id) constraint → one row per return).
//   • the delivery charge applies EVEN when the product value is ₹0
//     (within-window / "seller never made the sale") — so a seller-fault
//     return still bills the delivery cost their fault caused.
//   • when both are ₹0, the total is ₹0 → caller skips creating a debit.

import { computeSellerReturnDebitPaise } from './return.service';

describe('computeSellerReturnDebitPaise', () => {
  it('combines settled product value + delivery charge with an itemised breakdown', () => {
    const r = computeSellerReturnDebitPaise({
      productRecoverablePaise: 279920n, // ₹2799.20 (seller's settled payout)
      deliveryChargePaise: 10000n, // ₹100 reverse-logistics
    });
    expect(r.totalPaise).toBe(289920n);
    expect(r.breakdown).toBe(' (product ₹2799.20 + reverse-delivery ₹100.00)');
  });

  it('within-window / never-paid → delivery charge ONLY (no product value)', () => {
    const r = computeSellerReturnDebitPaise({
      productRecoverablePaise: 0n, // never settled → nothing to claw back
      deliveryChargePaise: 10000n,
    });
    expect(r.totalPaise).toBe(10000n);
    expect(r.breakdown).toBe(' (reverse-delivery ₹100.00)');
  });

  it('delivery disabled (₹0) → product value only (unchanged legacy behaviour)', () => {
    const r = computeSellerReturnDebitPaise({
      productRecoverablePaise: 279920n,
      deliveryChargePaise: 0n,
    });
    expect(r.totalPaise).toBe(279920n);
    expect(r.breakdown).toBe(' (product ₹2799.20)');
  });

  it('nothing to recover (never paid + delivery disabled) → ₹0, caller skips the debit', () => {
    const r = computeSellerReturnDebitPaise({
      productRecoverablePaise: 0n,
      deliveryChargePaise: 0n,
    });
    expect(r.totalPaise).toBe(0n);
    expect(r.breakdown).toBe('');
  });
});
