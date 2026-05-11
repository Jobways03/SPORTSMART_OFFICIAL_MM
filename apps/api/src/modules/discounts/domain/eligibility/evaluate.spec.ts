// Phase E (P1.3) — Eligibility evaluator tests.

import { evaluateEligibility } from './evaluate';
import type { EligibilityContext, EligibilityRule } from './types';

const ctx = (over: Partial<EligibilityContext> = {}): EligibilityContext => ({
  customer: over.customer,
  cart: over.cart,
  redemptionHistory: over.redemptionHistory,
});

const rule = (
  ruleType: EligibilityRule['ruleType'],
  valueJson: Record<string, unknown> = {},
): EligibilityRule => ({ ruleType, valueJson });

describe('evaluateEligibility — empty rules', () => {
  it('no rules → allowed', () => {
    expect(evaluateEligibility([], ctx())).toEqual({ allowed: true });
  });
});

describe('FIRST_ORDER_ONLY', () => {
  it('allows first-time customer (paidOrderCount=0)', () => {
    const r = evaluateEligibility(
      [rule('FIRST_ORDER_ONLY')],
      ctx({ customer: { id: 'c1', paidOrderCount: 0 } }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects repeat customer', () => {
    const r = evaluateEligibility(
      [rule('FIRST_ORDER_ONLY')],
      ctx({ customer: { id: 'c1', paidOrderCount: 3 } }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/first order/i);
    expect(r.ruleType).toBe('FIRST_ORDER_ONLY');
  });
  it('skips when paidOrderCount unknown', () => {
    const r = evaluateEligibility(
      [rule('FIRST_ORDER_ONLY')],
      ctx({ customer: { id: 'c1' } }),
    );
    expect(r.allowed).toBe(true);
  });
});

describe('NEW_CUSTOMER_ONLY', () => {
  it('allows new customer with 0 orders + young account', () => {
    const r = evaluateEligibility(
      [rule('NEW_CUSTOMER_ONLY', { maxAccountAgeDays: 30 })],
      ctx({ customer: { id: 'c', paidOrderCount: 0, accountAgeDays: 5 } }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects when paidOrderCount > 0', () => {
    const r = evaluateEligibility(
      [rule('NEW_CUSTOMER_ONLY', { maxAccountAgeDays: 30 })],
      ctx({ customer: { id: 'c', paidOrderCount: 1, accountAgeDays: 5 } }),
    );
    expect(r.allowed).toBe(false);
  });
  it('rejects when account older than threshold', () => {
    const r = evaluateEligibility(
      [rule('NEW_CUSTOMER_ONLY', { maxAccountAgeDays: 30 })],
      ctx({ customer: { id: 'c', paidOrderCount: 0, accountAgeDays: 90 } }),
    );
    expect(r.allowed).toBe(false);
  });
});

describe('CUSTOMER_TIER_IN', () => {
  it('allows when customer tier is in the list', () => {
    const r = evaluateEligibility(
      [rule('CUSTOMER_TIER_IN', { tiers: ['GOLD', 'PLATINUM'] })],
      ctx({ customer: { id: 'c', tier: 'GOLD' } }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects when customer tier is not in the list', () => {
    const r = evaluateEligibility(
      [rule('CUSTOMER_TIER_IN', { tiers: ['GOLD', 'PLATINUM'] })],
      ctx({ customer: { id: 'c', tier: 'SILVER' } }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/tier/i);
  });
  it('skips when tier is unknown', () => {
    const r = evaluateEligibility(
      [rule('CUSTOMER_TIER_IN', { tiers: ['GOLD'] })],
      ctx({ customer: { id: 'c' } }),
    );
    expect(r.allowed).toBe(true);
  });
});

describe('SELLER_IN / CATEGORY_IN / PRODUCT_IN / COLLECTION_IN', () => {
  const cartCtx = ctx({
    cart: {
      items: [
        {
          productId: 'P1',
          sellerId: 'S1',
          categoryId: 'CAT1',
          collectionIds: ['COL1', 'COL2'],
          quantity: 1,
          unitPriceInPaise: 100_000n,
        },
      ],
    },
  });

  it('SELLER_IN allows when cart contains an eligible seller', () => {
    expect(
      evaluateEligibility(
        [rule('SELLER_IN', { sellerIds: ['S1', 'S2'] })],
        cartCtx,
      ).allowed,
    ).toBe(true);
  });
  it('SELLER_IN rejects otherwise', () => {
    const r = evaluateEligibility(
      [rule('SELLER_IN', { sellerIds: ['SX'] })],
      cartCtx,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/items in your cart/i);
  });
  it('CATEGORY_IN allows when matching', () => {
    expect(
      evaluateEligibility(
        [rule('CATEGORY_IN', { categoryIds: ['CAT1'] })],
        cartCtx,
      ).allowed,
    ).toBe(true);
  });
  it('PRODUCT_IN allows when matching', () => {
    expect(
      evaluateEligibility(
        [rule('PRODUCT_IN', { productIds: ['P1'] })],
        cartCtx,
      ).allowed,
    ).toBe(true);
  });
  it('COLLECTION_IN allows when one of the cart collections matches', () => {
    expect(
      evaluateEligibility(
        [rule('COLLECTION_IN', { collectionIds: ['COL2'] })],
        cartCtx,
      ).allowed,
    ).toBe(true);
  });
});

describe('PAYMENT_METHOD_IN', () => {
  it('allows when payment method matches', () => {
    const r = evaluateEligibility(
      [rule('PAYMENT_METHOD_IN', { methods: ['ONLINE'] })],
      ctx({
        cart: { items: [], paymentMethod: 'ONLINE' },
      }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects when payment method does not match', () => {
    const r = evaluateEligibility(
      [rule('PAYMENT_METHOD_IN', { methods: ['ONLINE'] })],
      ctx({
        cart: { items: [], paymentMethod: 'COD' },
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/payment method/i);
  });
});

describe('CITY_IN / PINCODE_IN', () => {
  it('CITY_IN matches case-insensitively', () => {
    const r = evaluateEligibility(
      [rule('CITY_IN', { cities: ['Bengaluru'] })],
      ctx({
        cart: { items: [], address: { city: 'BENGALURU' } },
      }),
    );
    expect(r.allowed).toBe(true);
  });
  it('PINCODE_IN exact match', () => {
    const r = evaluateEligibility(
      [rule('PINCODE_IN', { pincodes: ['560001'] })],
      ctx({
        cart: { items: [], address: { pincode: '560001' } },
      }),
    );
    expect(r.allowed).toBe(true);
  });
  it('PINCODE_IN rejects mismatch', () => {
    const r = evaluateEligibility(
      [rule('PINCODE_IN', { pincodes: ['560001'] })],
      ctx({
        cart: { items: [], address: { pincode: '110001' } },
      }),
    );
    expect(r.allowed).toBe(false);
  });
});

describe('MIN_CART_VALUE', () => {
  it('allows when total >= min', () => {
    const r = evaluateEligibility(
      [rule('MIN_CART_VALUE', { minPaise: 50_000 })],
      ctx({
        cart: {
          items: [
            { productId: 'P1', quantity: 1, unitPriceInPaise: 60_000n },
          ],
        },
      }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects with shortfall message', () => {
    const r = evaluateEligibility(
      [rule('MIN_CART_VALUE', { minPaise: 100_000 })],
      ctx({
        cart: {
          items: [
            { productId: 'P1', quantity: 1, unitPriceInPaise: 60_000n },
          ],
        },
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Add ₹400\.00 more/);
  });
});

describe('MIN_ELIGIBLE_ITEM_QUANTITY', () => {
  it('allows when total qty meets min', () => {
    const r = evaluateEligibility(
      [rule('MIN_ELIGIBLE_ITEM_QUANTITY', { minQuantity: 3 })],
      ctx({
        cart: {
          items: [
            { productId: 'P1', quantity: 5, unitPriceInPaise: 100n },
          ],
        },
      }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects when below', () => {
    const r = evaluateEligibility(
      [rule('MIN_ELIGIBLE_ITEM_QUANTITY', { minQuantity: 5 })],
      ctx({
        cart: {
          items: [
            { productId: 'P1', quantity: 2, unitPriceInPaise: 100n },
          ],
        },
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/3 more eligible items/);
  });
});

describe('MAX_REDEMPTIONS_PER_CUSTOMER', () => {
  it('allows when below max', () => {
    const r = evaluateEligibility(
      [rule('MAX_REDEMPTIONS_PER_CUSTOMER', { max: 3 })],
      ctx({
        redemptionHistory: [
          { redeemedAt: new Date('2026-04-01') },
          { redeemedAt: new Date('2026-04-15') },
        ],
      }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects at max', () => {
    const r = evaluateEligibility(
      [rule('MAX_REDEMPTIONS_PER_CUSTOMER', { max: 2 })],
      ctx({
        redemptionHistory: [
          { redeemedAt: new Date('2026-04-01') },
          { redeemedAt: new Date('2026-04-15') },
        ],
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/maximum number of times/i);
  });
});

describe('MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW', () => {
  it('allows redemptions outside window', () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const r = evaluateEligibility(
      [
        rule('MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW', {
          max: 1,
          windowDays: 30,
        }),
      ],
      ctx({ redemptionHistory: [{ redeemedAt: oldDate }] }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects when within window', () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const r = evaluateEligibility(
      [
        rule('MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW', {
          max: 1,
          windowDays: 30,
        }),
      ],
      ctx({ redemptionHistory: [{ redeemedAt: recent }] }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/recently/i);
  });
});

describe('MIN_DAYS_BETWEEN_REDEMPTIONS', () => {
  it('allows when last redemption was longer ago', () => {
    const r = evaluateEligibility(
      [rule('MIN_DAYS_BETWEEN_REDEMPTIONS', { days: 7 })],
      ctx({
        redemptionHistory: [
          { redeemedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        ],
      }),
    );
    expect(r.allowed).toBe(true);
  });
  it('rejects with retry-day message', () => {
    const r = evaluateEligibility(
      [rule('MIN_DAYS_BETWEEN_REDEMPTIONS', { days: 7 })],
      ctx({
        redemptionHistory: [
          { redeemedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
        ],
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/can use this coupon again in \d+ day/);
  });
  it('passes when no history', () => {
    const r = evaluateEligibility(
      [rule('MIN_DAYS_BETWEEN_REDEMPTIONS', { days: 7 })],
      ctx({ redemptionHistory: [] }),
    );
    expect(r.allowed).toBe(true);
  });
});

describe('Multi-rule evaluation — first failure short-circuits', () => {
  it('returns the FIRST failing rule', () => {
    const r = evaluateEligibility(
      [
        rule('FIRST_ORDER_ONLY'),
        rule('MIN_CART_VALUE', { minPaise: 50_000 }),
      ],
      ctx({
        customer: { id: 'c', paidOrderCount: 5 },
        cart: { items: [{ productId: 'P', quantity: 1, unitPriceInPaise: 1n }] },
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.ruleType).toBe('FIRST_ORDER_ONLY');
  });

  it('all rules pass → allowed', () => {
    const r = evaluateEligibility(
      [
        rule('FIRST_ORDER_ONLY'),
        rule('MIN_CART_VALUE', { minPaise: 100 }),
        rule('PAYMENT_METHOD_IN', { methods: ['ONLINE'] }),
      ],
      ctx({
        customer: { id: 'c', paidOrderCount: 0 },
        cart: {
          items: [{ productId: 'P', quantity: 1, unitPriceInPaise: 200n }],
          paymentMethod: 'ONLINE',
        },
      }),
    );
    expect(r.allowed).toBe(true);
  });
});
