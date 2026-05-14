import 'reflect-metadata';
import {
  computeTcs,
  clampNetSupplyWithCarryForward,
  filingPeriodOf,
} from '../../src/modules/tax/domain/tcs-calculator';

// Phase 16 GST — TCS pure-function tests.
//
// Rate: 100 bps total (0.5% CGST + 0.5% SGST intra; 1% IGST inter).
// Half-away-from-zero rounding, BigInt throughout.

describe('computeTcs', () => {
  it('splits intra-state 50/50 between CGST and SGST', () => {
    const r = computeTcs({
      intraStateTaxableInPaise: 1_000_000n, // ₹10,000
      interStateTaxableInPaise: 0n,
    });
    expect(r.cgstTcsInPaise).toBe(5_000n); // 0.5% of ₹10k = ₹50
    expect(r.sgstTcsInPaise).toBe(5_000n);
    expect(r.igstTcsInPaise).toBe(0n);
    expect(r.totalTcsInPaise).toBe(10_000n); // 1% total
    expect(r.rateBps).toBe(100);
  });

  it('puts the entire 1% into IGST for inter-state', () => {
    const r = computeTcs({
      intraStateTaxableInPaise: 0n,
      interStateTaxableInPaise: 1_000_000n,
    });
    expect(r.cgstTcsInPaise).toBe(0n);
    expect(r.sgstTcsInPaise).toBe(0n);
    expect(r.igstTcsInPaise).toBe(10_000n);
    expect(r.totalTcsInPaise).toBe(10_000n);
  });

  it('handles mixed intra + inter splits', () => {
    const r = computeTcs({
      intraStateTaxableInPaise: 500_000n, // ₹5k
      interStateTaxableInPaise: 500_000n, // ₹5k
    });
    expect(r.cgstTcsInPaise).toBe(2_500n);
    expect(r.sgstTcsInPaise).toBe(2_500n);
    expect(r.igstTcsInPaise).toBe(5_000n);
    expect(r.totalTcsInPaise).toBe(10_000n);
  });

  it('clamps negative input to zero', () => {
    const r = computeTcs({
      intraStateTaxableInPaise: -100_000n,
      interStateTaxableInPaise: -200_000n,
    });
    expect(r.totalTcsInPaise).toBe(0n);
  });

  it('returns zero when both inputs are zero', () => {
    const r = computeTcs({
      intraStateTaxableInPaise: 0n,
      interStateTaxableInPaise: 0n,
    });
    expect(r.totalTcsInPaise).toBe(0n);
  });

  it('rounds half-away-from-zero per leg', () => {
    // 333 paise × 50 bps = 1.665 paise → rounds to 2 paise.
    const r = computeTcs({
      intraStateTaxableInPaise: 333n,
      interStateTaxableInPaise: 0n,
    });
    expect(r.cgstTcsInPaise).toBe(2n);
    expect(r.sgstTcsInPaise).toBe(2n);
    expect(r.totalTcsInPaise).toBe(4n);
  });

  it('honours a custom rate (50 bps)', () => {
    const r = computeTcs({
      intraStateTaxableInPaise: 1_000_000n,
      interStateTaxableInPaise: 0n,
      rateBps: 50,
    });
    // CGST = 25 bps, SGST = 25 bps. 25 / 10000 × 1_000_000 = 2500.
    expect(r.cgstTcsInPaise).toBe(2_500n);
    expect(r.sgstTcsInPaise).toBe(2_500n);
    expect(r.totalTcsInPaise).toBe(5_000n);
  });

  it('rejects out-of-range rates', () => {
    expect(() =>
      computeTcs({
        intraStateTaxableInPaise: 1n,
        interStateTaxableInPaise: 0n,
        rateBps: -1,
      }),
    ).toThrow(/out of range/);
    expect(() =>
      computeTcs({
        intraStateTaxableInPaise: 1n,
        interStateTaxableInPaise: 0n,
        rateBps: 20_000,
      }),
    ).toThrow(/out of range/);
  });

  it('handles odd-bps split via floor + ceil', () => {
    // 101 bps → CGST 50, SGST 51 (so two legs sum to 101).
    const r = computeTcs({
      intraStateTaxableInPaise: 1_000_000n,
      interStateTaxableInPaise: 0n,
      rateBps: 101,
    });
    expect(r.cgstTcsInPaise).toBe(5_000n);
    expect(r.sgstTcsInPaise).toBe(5_100n);
    expect(r.totalTcsInPaise).toBe(10_100n);
  });

  it('works at crore-scale without IEEE drift', () => {
    // ₹1 crore = 100,00,00,00 paise. 1% = ₹1 lakh = 1_00_00_00 paise.
    const r = computeTcs({
      intraStateTaxableInPaise: 100_00_00_00n,
      interStateTaxableInPaise: 0n,
    });
    expect(r.totalTcsInPaise).toBe(1_00_00_00n);
  });
});

describe('clampNetSupplyWithCarryForward', () => {
  it('returns gross when no reversal + no carry', () => {
    const r = clampNetSupplyWithCarryForward({
      grossTaxableInPaise: 1_000_000n,
      creditNoteReversalInPaise: 0n,
    });
    expect(r.netTaxableInPaise).toBe(1_000_000n);
    expect(r.carryForwardInPaise).toBe(0n);
  });

  it('subtracts credit-note reversal', () => {
    const r = clampNetSupplyWithCarryForward({
      grossTaxableInPaise: 1_000_000n,
      creditNoteReversalInPaise: 200_000n,
    });
    expect(r.netTaxableInPaise).toBe(800_000n);
    expect(r.carryForwardInPaise).toBe(0n);
  });

  it('clamps net at zero + emits carry-forward when reversal exceeds gross', () => {
    const r = clampNetSupplyWithCarryForward({
      grossTaxableInPaise: 100_000n,
      creditNoteReversalInPaise: 300_000n,
    });
    expect(r.netTaxableInPaise).toBe(0n);
    expect(r.carryForwardInPaise).toBe(200_000n);
  });

  it('applies prior-period carry-forward', () => {
    const r = clampNetSupplyWithCarryForward({
      grossTaxableInPaise: 1_000_000n,
      creditNoteReversalInPaise: 200_000n,
      priorCarryForwardInPaise: 100_000n,
    });
    // 1_000_000 - 200_000 - 100_000 = 700_000
    expect(r.netTaxableInPaise).toBe(700_000n);
    expect(r.carryForwardInPaise).toBe(0n);
  });

  it('emits second-period carry when prior + reversal still exceeds gross', () => {
    const r = clampNetSupplyWithCarryForward({
      grossTaxableInPaise: 100_000n,
      creditNoteReversalInPaise: 50_000n,
      priorCarryForwardInPaise: 200_000n,
    });
    // 100k - 50k - 200k = -150k → net 0, carry 150k.
    expect(r.netTaxableInPaise).toBe(0n);
    expect(r.carryForwardInPaise).toBe(150_000n);
  });
});

describe('filingPeriodOf', () => {
  it('returns IST-correct YYYY-MM for mid-month dates', () => {
    expect(filingPeriodOf(new Date(Date.UTC(2026, 3, 15, 12, 0, 0)))).toBe(
      '2026-04',
    );
  });

  it('handles 1 Apr 00:00 IST boundary (= 31 Mar 18:30 UTC)', () => {
    expect(filingPeriodOf(new Date(Date.UTC(2026, 2, 31, 18, 30, 0)))).toBe(
      '2026-04',
    );
  });

  it('handles 31 Mar 23:59 IST boundary (= 31 Mar 18:29 UTC)', () => {
    expect(filingPeriodOf(new Date(Date.UTC(2026, 2, 31, 18, 29, 0)))).toBe(
      '2026-03',
    );
  });

  it('handles 1 Jan 00:00 IST (= 31 Dec 18:30 UTC previous year)', () => {
    expect(filingPeriodOf(new Date(Date.UTC(2025, 11, 31, 18, 30, 0)))).toBe(
      '2026-01',
    );
  });
});
