import {
  settlementNetPayableInPaise,
  settlementNetFromRow,
} from './settlement-net';

describe('settlementNetPayableInPaise', () => {
  it('deducts the statutory trio (commission-GST + TCS + TDS)', () => {
    // gross ₹18,872 (1,887,200 paise) − (GST 100 + TCS 200 + TDS 300) = 1,886,600
    const net = settlementNetPayableInPaise({
      grossInPaise: 1_887_200n,
      tcsDeductedInPaise: 200n,
      tdsDeductedInPaise: 300n,
      totalCommissionGstInPaise: 100n,
    });
    expect(net).toBe(1_887_200n - 600n);
  });

  it('clamps at zero — never a negative payout', () => {
    const net = settlementNetPayableInPaise({
      grossInPaise: 100n,
      tcsDeductedInPaise: 0n,
      tdsDeductedInPaise: 500n,
      totalCommissionGstInPaise: 0n,
    });
    expect(net).toBe(0n);
  });
});

describe('settlementNetFromRow', () => {
  it('reads string/number/null deduction columns off a row', () => {
    const net = settlementNetFromRow(
      {
        tcsDeductedInPaise: '100',
        tdsDeductedInPaise: 200,
        totalCommissionGstInPaise: undefined,
      },
      10_000n,
    );
    expect(net).toBe(10_000n - 300n);
  });
});
