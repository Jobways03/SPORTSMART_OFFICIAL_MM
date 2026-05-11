// Phase E (P1.2) — Stacking engine tests.
//
// Covers each acceptance test from the spec plus the negative cases.
// Pure functions — no Prisma. Each `discount(...)` builds a minimal
// stackable shape with the named class.

import { canStack } from './can-stack';
import { classifyDiscount } from './classify';
import type { StackableDiscount } from './types';

const productDiscount = (
  id: string,
  over: Partial<StackableDiscount> = {},
): StackableDiscount => ({
  id,
  type: 'AMOUNT_OFF_PRODUCTS',
  method: 'CODE',
  source: 'CODE',
  combineProduct: false,
  combineOrder: false,
  combineShipping: false,
  ...over,
});

const orderDiscount = (
  id: string,
  over: Partial<StackableDiscount> = {},
): StackableDiscount => ({
  id,
  type: 'AMOUNT_OFF_ORDER',
  method: 'CODE',
  source: 'CODE',
  combineProduct: false,
  combineOrder: false,
  combineShipping: false,
  ...over,
});

const shippingDiscount = (
  id: string,
  over: Partial<StackableDiscount> = {},
): StackableDiscount => ({
  id,
  type: 'FREE_SHIPPING',
  method: 'CODE',
  source: 'CODE',
  combineProduct: false,
  combineOrder: false,
  combineShipping: false,
  ...over,
});

const bxgy = (
  id: string,
  over: Partial<StackableDiscount> = {},
): StackableDiscount => ({
  id,
  type: 'BUY_X_GET_Y',
  method: 'CODE',
  source: 'CODE',
  combineProduct: false,
  combineOrder: false,
  combineShipping: false,
  ...over,
});

const automaticPromo = (
  id: string,
  over: Partial<StackableDiscount> = {},
): StackableDiscount => ({
  id,
  type: 'AMOUNT_OFF_ORDER',
  method: 'AUTOMATIC',
  source: 'AUTOMATIC',
  combineProduct: false,
  combineOrder: false,
  combineShipping: false,
  ...over,
});

const affiliateCoupon = (
  id: string,
  over: Partial<StackableDiscount> = {},
): StackableDiscount => ({
  id,
  type: 'AMOUNT_OFF_ORDER',
  method: 'CODE',
  source: 'AFFILIATE',
  combineProduct: false,
  combineOrder: false,
  combineShipping: false,
  ...over,
});

describe('classifyDiscount', () => {
  it('AMOUNT_OFF_PRODUCTS → PRODUCT_DISCOUNT', () => {
    expect(classifyDiscount(productDiscount('a'))).toBe('PRODUCT_DISCOUNT');
  });
  it('AMOUNT_OFF_ORDER → ORDER_DISCOUNT', () => {
    expect(classifyDiscount(orderDiscount('a'))).toBe('ORDER_DISCOUNT');
  });
  it('FREE_SHIPPING → SHIPPING_DISCOUNT', () => {
    expect(classifyDiscount(shippingDiscount('a'))).toBe('SHIPPING_DISCOUNT');
  });
  it('BUY_X_GET_Y → BUY_X_GET_Y', () => {
    expect(classifyDiscount(bxgy('a'))).toBe('BUY_X_GET_Y');
  });
  it('method=AUTOMATIC → AUTOMATIC_PROMO regardless of type', () => {
    expect(classifyDiscount(automaticPromo('a'))).toBe('AUTOMATIC_PROMO');
  });
  it('source=AFFILIATE → AFFILIATE_COUPON regardless of type/method', () => {
    expect(classifyDiscount(affiliateCoupon('a'))).toBe('AFFILIATE_COUPON');
  });
  it('AFFILIATE has priority over AUTOMATIC', () => {
    expect(
      classifyDiscount({
        ...affiliateCoupon('a'),
        method: 'AUTOMATIC',
      }),
    ).toBe('AFFILIATE_COUPON');
  });
});

describe('canStack — empty state', () => {
  it('first coupon always allowed', () => {
    const r = canStack([], orderDiscount('a'));
    expect(r.allowed).toBe(true);
    expect(r.candidateClass).toBe('ORDER_DISCOUNT');
  });
});

describe('canStack — self-stacking guard', () => {
  it('cannot apply the same discount id twice', () => {
    const r = canStack([orderDiscount('a')], orderDiscount('a'));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/already applied/);
    expect(r.conflictWithDiscountId).toBe('a');
  });
});

describe('canStack — only one manual coupon (default)', () => {
  it('two order-level coupons rejected without combine flags', () => {
    const r = canStack([orderDiscount('a')], orderDiscount('b'));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/cannot be combined/);
  });

  it('two order-level coupons allowed when both have combineOrder=true', () => {
    const r = canStack(
      [orderDiscount('a', { combineOrder: true })],
      orderDiscount('b', { combineOrder: true }),
    );
    expect(r.allowed).toBe(true);
  });

  it('two product coupons rejected without combine flags', () => {
    const r = canStack([productDiscount('a')], productDiscount('b'));
    expect(r.allowed).toBe(false);
  });

  it('two product coupons allowed when both have combineProduct=true', () => {
    const r = canStack(
      [productDiscount('a', { combineProduct: true })],
      productDiscount('b', { combineProduct: true }),
    );
    expect(r.allowed).toBe(true);
  });

  it('one-sided combine flag is not enough — both must opt in', () => {
    const r = canStack(
      [orderDiscount('a', { combineOrder: true })],
      orderDiscount('b', { combineOrder: false }),
    );
    expect(r.allowed).toBe(false);
  });
});

describe('canStack — product × order pair (rule 3)', () => {
  it('rejected without combineOrder on both', () => {
    const r = canStack([productDiscount('p')], orderDiscount('o'));
    expect(r.allowed).toBe(false);
  });

  it('allowed with cross combine flags (each side opts into the other)', () => {
    // PRODUCT × ORDER pair: product must allow ORDER class
    // (combineOrder), order must allow PRODUCT class (combineProduct).
    const r = canStack(
      [productDiscount('p', { combineOrder: true })],
      orderDiscount('o', { combineProduct: true }),
    );
    expect(r.allowed).toBe(true);
  });
});

describe('canStack — shipping (rule 2)', () => {
  it('FREE_SHIPPING + ORDER coupon rejected without combineShipping', () => {
    const r = canStack([orderDiscount('o')], shippingDiscount('s'));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/shipping/i);
  });

  it('FREE_SHIPPING + ORDER allowed when both have combineShipping=true', () => {
    const r = canStack(
      [orderDiscount('o', { combineShipping: true })],
      shippingDiscount('s', { combineShipping: true }),
    );
    expect(r.allowed).toBe(true);
  });

  it('FREE_SHIPPING + PRODUCT requires combineShipping on both', () => {
    const r1 = canStack(
      [productDiscount('p')],
      shippingDiscount('s', { combineShipping: true }),
    );
    expect(r1.allowed).toBe(false);
    const r2 = canStack(
      [productDiscount('p', { combineShipping: true })],
      shippingDiscount('s', { combineShipping: true }),
    );
    expect(r2.allowed).toBe(true);
  });

  it('two FREE_SHIPPING coupons need combineShipping on both', () => {
    const r = canStack([shippingDiscount('a')], shippingDiscount('b'));
    expect(r.allowed).toBe(false);
    const r2 = canStack(
      [shippingDiscount('a', { combineShipping: true })],
      shippingDiscount('b', { combineShipping: true }),
    );
    expect(r2.allowed).toBe(true);
  });
});

describe('canStack — automatic promo + manual coupon (rule 4)', () => {
  it('AUTOMATIC + manual ORDER coupon rejected without combineOrder', () => {
    const r = canStack([automaticPromo('a')], orderDiscount('o'));
    expect(r.allowed).toBe(false);
  });

  it('AUTOMATIC + manual ORDER allowed when both have combineOrder', () => {
    const r = canStack(
      [automaticPromo('a', { combineOrder: true })],
      orderDiscount('o', { combineOrder: true }),
    );
    expect(r.allowed).toBe(true);
  });

  it('AUTOMATIC + manual PRODUCT allowed when AUTOMATIC has combineProduct + PRODUCT has combineOrder', () => {
    // AUTOMATIC's class flag is combineOrder; PRODUCT's class flag
    // is combineProduct. Each side opts in via the other's class flag.
    const r = canStack(
      [automaticPromo('a', { combineProduct: true })],
      productDiscount('p', { combineOrder: true }),
    );
    expect(r.allowed).toBe(true);
  });
});

describe('canStack — affiliate coupon (rule 5)', () => {
  it('AFFILIATE + ORDER manual rejected by default', () => {
    const r = canStack([affiliateCoupon('aff')], orderDiscount('o'));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/[Aa]ffiliate/);
  });

  it('AFFILIATE + ORDER allowed when both opt in', () => {
    const r = canStack(
      [affiliateCoupon('aff', { combineOrder: true })],
      orderDiscount('o', { combineOrder: true }),
    );
    expect(r.allowed).toBe(true);
  });

  it('two AFFILIATE coupons rejected by default', () => {
    const r = canStack([affiliateCoupon('a')], affiliateCoupon('b'));
    expect(r.allowed).toBe(false);
  });

  it('AFFILIATE + AUTOMATIC promo rejected by default', () => {
    const r = canStack([affiliateCoupon('a')], automaticPromo('p'));
    expect(r.allowed).toBe(false);
  });
});

describe('canStack — BXGY (rule 6)', () => {
  it('BXGY + PRODUCT discount rejected without combineProduct', () => {
    const r = canStack([bxgy('b')], productDiscount('p'));
    expect(r.allowed).toBe(false);
  });

  it('BXGY + PRODUCT allowed when both have combineProduct=true', () => {
    const r = canStack(
      [bxgy('b', { combineProduct: true })],
      productDiscount('p', { combineProduct: true }),
    );
    expect(r.allowed).toBe(true);
  });

  it('BXGY + ORDER allowed when BXGY has combineOrder + ORDER has combineProduct', () => {
    // BXGY's class flag is combineProduct; ORDER's class flag is
    // combineOrder. Each side opts in via the other's class flag.
    const r1 = canStack([bxgy('b')], orderDiscount('o'));
    expect(r1.allowed).toBe(false);
    const r2 = canStack(
      [bxgy('b', { combineOrder: true })],
      orderDiscount('o', { combineProduct: true }),
    );
    expect(r2.allowed).toBe(true);
  });

  it('two BXGY require combineProduct on both', () => {
    const r1 = canStack([bxgy('a')], bxgy('b'));
    expect(r1.allowed).toBe(false);
    const r2 = canStack(
      [bxgy('a', { combineProduct: true })],
      bxgy('b', { combineProduct: true }),
    );
    expect(r2.allowed).toBe(true);
  });
});

describe('canStack — multiple existing discounts', () => {
  it('candidate must be compatible with EVERY existing discount', () => {
    const r = canStack(
      [
        orderDiscount('o', { combineOrder: true, combineShipping: true }),
        shippingDiscount('s', { combineShipping: true, combineOrder: true }),
      ],
      productDiscount('p', { combineProduct: true }),
    );
    // The product candidate is compatible with shipping (both have
    // combineShipping in the broader pair) but NOT with the order
    // coupon (PRODUCT × ORDER needs combineOrder on both — order has
    // it, but product doesn't).
    expect(r.allowed).toBe(false);
  });

  it('reports the first conflicting discount', () => {
    const r = canStack([orderDiscount('a'), orderDiscount('b')], orderDiscount('c'));
    // The first applied discount ('a') is the conflict.
    expect(r.allowed).toBe(false);
    expect(r.conflictWithDiscountId).toBe('a');
  });
});
