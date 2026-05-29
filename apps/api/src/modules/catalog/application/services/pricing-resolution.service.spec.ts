/**
 * Phase 44 (2026-05-21) — locks the contract on PricingResolutionService.
 * Tests use the static pickBestTier helper so they don't depend on
 * Prisma. The DB-level eligibility filter (isActive, schedule window)
 * is covered by the Prisma query — out of scope for unit tests.
 *
 * Note: computeEffectivePrice calls Number(...) on the Decimal-typed
 * inputs at runtime, so passing plain numbers works correctly. We
 * cast to `any` at the call sites to satisfy TypeScript's strict
 * Prisma.Decimal signature.
 */

import { PricingResolutionService } from './pricing-resolution.service';

type Tier = {
  id: string;
  variantId: string | null;
  discountPercent: number | null;
  fixedUnitPrice: number | null;
};

function tier(overrides: Partial<Tier> & { id: string }): Tier {
  return {
    variantId: null,
    discountPercent: 10,
    fixedUnitPrice: null,
    ...overrides,
  };
}

const pick = (tiers: Tier[], variantId: string | null, listPrice: number) =>
  PricingResolutionService.pickBestTier(tiers as any, variantId, listPrice);

describe('PricingResolutionService.pickBestTier', () => {
  it('returns base when no tiers eligible', () => {
    const result = pick([], null, 100);
    expect(result.effectiveUnitPrice).toBe(100);
    expect(result.appliedTierId).toBeNull();
  });

  it('applies discountPercent against listPrice', () => {
    const result = pick([tier({ id: 't1', discountPercent: 10 })], null, 100);
    expect(result.effectiveUnitPrice).toBe(90);
    expect(result.appliedTierId).toBe('t1');
    expect(result.appliedDiscountPercent).toBe(10);
    expect(result.appliedFixedUnitPrice).toBeNull();
  });

  it('applies fixedUnitPrice as absolute override', () => {
    const result = pick(
      [tier({ id: 't1', discountPercent: null, fixedUnitPrice: 75 })],
      null,
      100,
    );
    expect(result.effectiveUnitPrice).toBe(75);
    expect(result.appliedFixedUnitPrice).toBe(75);
    expect(result.appliedDiscountPercent).toBeNull();
  });

  it('picks best-effective discount, not first-match (audit Gap #9)', () => {
    // Audit's footgun: a higher-qty band with LOWER discount. The
    // resolver picks the better-priced tier regardless of order.
    const result = pick(
      [
        tier({ id: 'lower-qty-15', discountPercent: 15 }),
        tier({ id: 'higher-qty-5', discountPercent: 5 }),
      ],
      null,
      100,
    );
    expect(result.appliedTierId).toBe('lower-qty-15');
    expect(result.effectiveUnitPrice).toBe(85);
  });

  it('variant-scoped beats product-scoped at the same effective price (Gap #10)', () => {
    const result = pick(
      [
        tier({ id: 'product-wide', variantId: null, discountPercent: 10 }),
        tier({ id: 'variant-spec', variantId: 'V1', discountPercent: 10 }),
      ],
      'V1',
      100,
    );
    expect(result.appliedTierId).toBe('variant-spec');
  });

  it('better-effective product-scoped wins over variant-scoped', () => {
    const result = pick(
      [
        tier({ id: 'variant-5', variantId: 'V1', discountPercent: 5 }),
        tier({ id: 'product-20', variantId: null, discountPercent: 20 }),
      ],
      'V1',
      100,
    );
    expect(result.appliedTierId).toBe('product-20');
    expect(result.effectiveUnitPrice).toBe(80);
  });

  it('fixed-price tier wins when it undercuts a percent tier', () => {
    const result = pick(
      [
        tier({ id: 'pct-10', discountPercent: 10 }), // 100 → 90
        tier({ id: 'fixed-80', discountPercent: null, fixedUnitPrice: 80 }),
      ],
      null,
      100,
    );
    expect(result.appliedTierId).toBe('fixed-80');
    expect(result.effectiveUnitPrice).toBe(80);
  });

  it('rounds money to 2dp', () => {
    const result = pick([tier({ id: 't1', discountPercent: 10 })], null, 333.33);
    // 333.33 * 0.9 = 299.997 → 300.00 half-up
    expect(result.effectiveUnitPrice).toBe(300);
  });
});
