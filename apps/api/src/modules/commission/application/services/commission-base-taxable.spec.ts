import { Prisma } from '@prisma/client';
import { rateCommissionOnTaxable } from './commission-processor.service';

/**
 * Phase 252 — rate-based commission on the GST-EXCLUSIVE taxable supply.
 *
 * The policy: charge a percentage commission on the snapshot's taxable value
 * (GST backed out, net of pre-supply discount), matching TCS §52, instead of
 * the inclusive price. Revenue (totalPlatformAmount) is unchanged; only the
 * commission/settlement split moves.
 */
describe('rateCommissionOnTaxable (Phase 252)', () => {
  const D = (n: string | number) => new Prisma.Decimal(n);

  it('₹5000 inclusive @18% GST, 20% rate → commission on ₹4237.28 taxable = ₹847.46', () => {
    // taxable of a ₹5000 inclusive line @18% = 423728 paise (the snapshot value).
    const { commission, settlement } = rateCommissionOnTaxable({
      totalPlatformAmount: D(5000),
      taxablePaise: 423728n,
      ratePercent: 20,
    });
    expect(commission.toFixed(2)).toBe('847.46'); // was ₹1000 on the inclusive base
    expect(settlement.toFixed(2)).toBe('4152.54'); // seller keeps ₹152.54 more
    // Reconciliation invariant: commission == revenue − settlement.
    expect(commission.plus(settlement).toFixed(2)).toBe('5000.00');
  });

  it('no-op for tax-EXCLUSIVE SKUs: taxable == price → commission unchanged (₹1000)', () => {
    // For an exclusive product the snapshot taxable equals the line price.
    const { commission, settlement } = rateCommissionOnTaxable({
      totalPlatformAmount: D(5000),
      taxablePaise: 500000n, // ₹5000 == the inclusive line (no GST baked in)
      ratePercent: 20,
    });
    expect(commission.toFixed(2)).toBe('1000.00');
    expect(settlement.toFixed(2)).toBe('4000.00');
  });

  it('rounds half-away-up at 2dp', () => {
    // ₹100.25 taxable × 10% = 10.025 → 10.03
    const { commission } = rateCommissionOnTaxable({
      totalPlatformAmount: D(200),
      taxablePaise: 10025n,
      ratePercent: 10,
    });
    expect(commission.toFixed(2)).toBe('10.03');
  });

  it('clamps commission to never exceed revenue (defensive)', () => {
    const { commission, settlement } = rateCommissionOnTaxable({
      totalPlatformAmount: D(100),
      taxablePaise: 100_000_000n, // absurd taxable ⇒ 20% would be ₹200,000
      ratePercent: 20,
    });
    expect(commission.toFixed(2)).toBe('100.00'); // capped at revenue
    expect(settlement.toFixed(2)).toBe('0.00');
  });
});
