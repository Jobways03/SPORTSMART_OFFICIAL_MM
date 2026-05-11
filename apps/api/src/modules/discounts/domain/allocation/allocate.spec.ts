// Phase B (P0.1) — Allocation engine tests.
//
// Covers the 9 acceptance cases from the spec plus rounding edge
// cases and BXGY fairness.

import {
  allocateBxgy,
  allocateOrderLevel,
  percentageToPaiseTotal,
} from './allocate';
import type { AllocatableItem } from './types';

const item = (over: Partial<AllocatableItem> = {}): AllocatableItem => ({
  orderItemId: over.orderItemId ?? 'item-1',
  productId: over.productId ?? 'prod-1',
  variantId: over.variantId ?? null,
  subOrderId: over.subOrderId ?? 'sub-1',
  sellerId: over.sellerId ?? 'seller-1',
  grossInPaise: over.grossInPaise ?? 100_000n,
  unitPriceInPaise: over.unitPriceInPaise ?? 100_000n,
  quantity: over.quantity ?? 1,
});

describe('allocateOrderLevel — fixed-amount discount across items', () => {
  it('₹300 fixed across ₹1,000 + ₹2,000 → ₹100 + ₹200', () => {
    const items = [
      item({ orderItemId: 'a', grossInPaise: 100_000n }),
      item({ orderItemId: 'b', grossInPaise: 200_000n }),
    ];
    const r = allocateOrderLevel({
      items,
      totalDiscountInPaise: 30_000n,
    });
    expect(r.allocations).toHaveLength(2);
    expect(r.allocations[0].discountInPaise).toBe(10_000n);
    expect(r.allocations[1].discountInPaise).toBe(20_000n);
    expect(r.totalAllocatedInPaise).toBe(30_000n);
  });

  it('20% across ₹1,000 + ₹1,000 → ₹100 + ₹100 (sum equals MasterOrder.discountAmountInPaise)', () => {
    const items = [
      item({ orderItemId: 'a', grossInPaise: 100_000n }),
      item({ orderItemId: 'b', grossInPaise: 100_000n }),
    ];
    const total = percentageToPaiseTotal(200_000n, 20);
    const r = allocateOrderLevel({ items, totalDiscountInPaise: total });
    expect(r.totalAllocatedInPaise).toBe(40_000n);
    expect(r.allocations.map((a) => a.discountInPaise).sort()).toEqual([
      20_000n,
      20_000n,
    ]);
  });

  it('rounding remainder goes to highest-gross item, deterministic on ties', () => {
    // ₹1 across 3 equal items — 100 paise / 3 = 33 + 33 + 33 = 99,
    // remainder 1 → goes to lex-smallest id.
    const items = [
      item({ orderItemId: 'c', grossInPaise: 100_000n }),
      item({ orderItemId: 'a', grossInPaise: 100_000n }),
      item({ orderItemId: 'b', grossInPaise: 100_000n }),
    ];
    const r = allocateOrderLevel({ items, totalDiscountInPaise: 100n });
    expect(r.totalAllocatedInPaise).toBe(100n);
    const byId = Object.fromEntries(
      r.allocations.map((a) => [a.orderItemId, a.discountInPaise]),
    );
    // 'a' is lex-smallest → gets the extra paise.
    expect(byId.a).toBe(34n);
    expect(byId.b).toBe(33n);
    expect(byId.c).toBe(33n);
  });

  it('order-independent: shuffling input items yields same allocation', () => {
    const items = [
      item({ orderItemId: 'a', grossInPaise: 333_333n }),
      item({ orderItemId: 'b', grossInPaise: 666_667n }),
    ];
    const r1 = allocateOrderLevel({
      items,
      totalDiscountInPaise: 100_000n,
    });
    const r2 = allocateOrderLevel({
      items: [...items].reverse(),
      totalDiscountInPaise: 100_000n,
    });
    const byId = (r: typeof r1) =>
      Object.fromEntries(
        r.allocations.map((a) => [a.orderItemId, a.discountInPaise]),
      );
    expect(byId(r1)).toEqual(byId(r2));
  });

  it('eligibleProductIds limits allocation to specified products', () => {
    const items = [
      item({ orderItemId: 'a', productId: 'eligible', grossInPaise: 100_000n }),
      item({
        orderItemId: 'b',
        productId: 'not-eligible',
        grossInPaise: 100_000n,
      }),
    ];
    const r = allocateOrderLevel({
      items,
      totalDiscountInPaise: 30_000n,
      eligibleProductIds: new Set(['eligible']),
    });
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].orderItemId).toBe('a');
    expect(r.allocations[0].discountInPaise).toBe(30_000n);
    expect(r.totalAllocatedInPaise).toBe(30_000n);
  });

  it('multi-seller order: allocations carry subOrderId/sellerId per row', () => {
    const items = [
      item({
        orderItemId: 'a',
        subOrderId: 'sub-A',
        sellerId: 'seller-A',
        grossInPaise: 100_000n,
      }),
      item({
        orderItemId: 'b',
        subOrderId: 'sub-B',
        sellerId: 'seller-B',
        grossInPaise: 100_000n,
      }),
    ];
    const r = allocateOrderLevel({
      items,
      totalDiscountInPaise: 20_000n,
    });
    expect(r.allocations[0].subOrderId).toBe('sub-A');
    expect(r.allocations[0].sellerId).toBe('seller-A');
    expect(r.allocations[1].subOrderId).toBe('sub-B');
    expect(r.allocations[1].sellerId).toBe('seller-B');
  });

  it('zero discount returns empty', () => {
    const r = allocateOrderLevel({
      items: [item()],
      totalDiscountInPaise: 0n,
    });
    expect(r.allocations).toHaveLength(0);
    expect(r.totalAllocatedInPaise).toBe(0n);
  });

  it('rejects negative discount', () => {
    expect(() =>
      allocateOrderLevel({ items: [item()], totalDiscountInPaise: -1n }),
    ).toThrow(/negative/);
  });

  it('rejects empty eligible set with non-zero discount', () => {
    expect(() =>
      allocateOrderLevel({
        items: [item()],
        totalDiscountInPaise: 100n,
        eligibleProductIds: new Set(),
      }),
    ).toThrow(/No eligible items/);
  });

  it('caps allocation at totalGross when discount exceeds total', () => {
    // Customer cannot get a refund larger than what they paid.
    const items = [item({ grossInPaise: 100n })];
    const r = allocateOrderLevel({
      items,
      totalDiscountInPaise: 10_000n, // ridiculously large
    });
    expect(r.totalAllocatedInPaise).toBe(100n);
    expect(r.allocations[0].discountInPaise).toBe(100n);
  });

  it('handles BigInt amounts beyond Number.MAX_SAFE_INTEGER', () => {
    // ~1 trillion paise = ₹1,000 crore. BigInt math must stay exact.
    const items = [
      item({ orderItemId: 'a', grossInPaise: 500_000_000_000_000n }),
      item({ orderItemId: 'b', grossInPaise: 500_000_000_000_000n }),
    ];
    const r = allocateOrderLevel({
      items,
      totalDiscountInPaise: 100_000_000_000_000n, // 10%
    });
    expect(r.allocations[0].discountInPaise).toBe(50_000_000_000_000n);
    expect(r.allocations[1].discountInPaise).toBe(50_000_000_000_000n);
    expect(r.totalAllocatedInPaise).toBe(100_000_000_000_000n);
  });
});

describe('allocateBxgy — discount attaches to GET items only', () => {
  it('FREE: get item refund is 100% of unit price', () => {
    const items = [
      item({
        orderItemId: 'buy',
        productId: 'buy-prod',
        grossInPaise: 100_000n,
        unitPriceInPaise: 100_000n,
        quantity: 1,
      }),
      item({
        orderItemId: 'free',
        productId: 'get-prod',
        grossInPaise: 50_000n,
        unitPriceInPaise: 50_000n,
        quantity: 1,
      }),
    ];
    const r = allocateBxgy({
      items,
      getEligibleProductIds: new Set(['get-prod']),
      getQuantity: 1,
      getDiscountType: 'FREE',
    });
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].orderItemId).toBe('free');
    expect(r.allocations[0].discountInPaise).toBe(50_000n);
    expect(r.totalAllocatedInPaise).toBe(50_000n);
  });

  it('cheapest-first fairness: picks cheapest eligible units when getQuantity < total eligible', () => {
    const items = [
      item({
        orderItemId: 'expensive',
        productId: 'get',
        grossInPaise: 200_000n,
        unitPriceInPaise: 200_000n,
        quantity: 1,
      }),
      item({
        orderItemId: 'cheap',
        productId: 'get',
        grossInPaise: 50_000n,
        unitPriceInPaise: 50_000n,
        quantity: 1,
      }),
    ];
    const r = allocateBxgy({
      items,
      getEligibleProductIds: new Set(['get']),
      getQuantity: 1,
      getDiscountType: 'FREE',
    });
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].orderItemId).toBe('cheap');
    expect(r.allocations[0].discountInPaise).toBe(50_000n);
  });

  it('PERCENTAGE: 50% off get items', () => {
    const items = [
      item({
        orderItemId: 'g',
        productId: 'get',
        grossInPaise: 100_000n,
        unitPriceInPaise: 100_000n,
      }),
    ];
    const r = allocateBxgy({
      items,
      getEligibleProductIds: new Set(['get']),
      getQuantity: 1,
      getDiscountType: 'PERCENTAGE',
      getDiscountPercentage: 50,
    });
    expect(r.allocations[0].discountInPaise).toBe(50_000n);
  });

  it('AMOUNT_OFF: capped at unit price (cannot make line negative)', () => {
    const items = [
      item({
        orderItemId: 'g',
        productId: 'get',
        grossInPaise: 100_000n,
        unitPriceInPaise: 100_000n,
      }),
    ];
    const r = allocateBxgy({
      items,
      getEligibleProductIds: new Set(['get']),
      getQuantity: 1,
      getDiscountType: 'AMOUNT_OFF',
      getDiscountValueInPaise: 999_999_999n, // way more than unit price
    });
    // Capped at unit price.
    expect(r.allocations[0].discountInPaise).toBe(100_000n);
  });

  it('multi-unit line: rolls up per-item allocation when multiple slots come from same line', () => {
    const items = [
      item({
        orderItemId: 'multi',
        productId: 'get',
        grossInPaise: 300_000n, // 3 × ₹1,000
        unitPriceInPaise: 100_000n,
        quantity: 3,
      }),
    ];
    const r = allocateBxgy({
      items,
      getEligibleProductIds: new Set(['get']),
      getQuantity: 2,
      getDiscountType: 'FREE',
    });
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].discountInPaise).toBe(200_000n); // 2 × ₹1,000
  });

  it('zero getQuantity returns empty', () => {
    const r = allocateBxgy({
      items: [item({ productId: 'get' })],
      getEligibleProductIds: new Set(['get']),
      getQuantity: 0,
      getDiscountType: 'FREE',
    });
    expect(r.allocations).toHaveLength(0);
  });

  it('rejects empty eligible set when getQuantity > 0', () => {
    expect(() =>
      allocateBxgy({
        items: [item({ productId: 'other' })],
        getEligibleProductIds: new Set(['get']),
        getQuantity: 1,
        getDiscountType: 'FREE',
      }),
    ).toThrow(/No eligible GET items/);
  });

  it('rejects PERCENTAGE outside 0–100', () => {
    expect(() =>
      allocateBxgy({
        items: [item({ productId: 'get' })],
        getEligibleProductIds: new Set(['get']),
        getQuantity: 1,
        getDiscountType: 'PERCENTAGE',
        getDiscountPercentage: 150,
      }),
    ).toThrow(/between 0 and 100/);
  });
});

describe('percentageToPaiseTotal', () => {
  it('20% of ₹1,600 = ₹320', () => {
    expect(percentageToPaiseTotal(160_000n, 20)).toBe(32_000n);
  });
  it('handles non-integer percentages (e.g. 12.5%)', () => {
    expect(percentageToPaiseTotal(100_000n, 12.5)).toBe(12_500n);
  });
  it('rejects out-of-range percentages', () => {
    expect(() => percentageToPaiseTotal(100n, -1)).toThrow();
    expect(() => percentageToPaiseTotal(100n, 101)).toThrow();
  });
});
