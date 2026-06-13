/**
 * Phase 61 (2026-05-22) — pins the cart management flow audit
 * gap closures:
 *
 *   - DTO validations on every body shape (audit Gap #5)
 *   - PATCH quantity ≤ 0 rejected at the service edge (audit Gap #6)
 *   - Stock floor check inside the FOR UPDATE primitive (audit Gap #7)
 *   - getCart drops/flags archived/deleted products (audit Gap #9)
 *   - sellerShopName threaded through the projection (audit Gap #2)
 *   - priceChanged flag when live price drifts from snapshot
 *     (audit Gap #22)
 *   - mergeAnonymousCart parallelised + per-item failure reasons
 *     (audit Gaps #15 + #19)
 *   - Cart-line cap enforced via the repo (audit Gap #23)
 *   - Cart abandonment sweep deletes ≥ cutoff carts (audit Gap #12)
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import { CartService } from './cart.service';
import { CartRepository } from '../../domain/repositories/cart.repository.interface';
import {
  AddCartItemDto,
  MergeCartDto,
  UpdateCartItemDto,
} from '../../presentation/dtos/cart.dto';

function flattenErrors(errs: any[]): string[] {
  const out: string[] = [];
  for (const e of errs) {
    if (e.constraints) out.push(...Object.values<string>(e.constraints));
    if (e.children?.length) out.push(...flattenErrors(e.children));
  }
  return out;
}
async function dtoMessages<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<string[]> {
  return flattenErrors(await validate(plainToInstance(cls, input) as object));
}

const UUID = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';

function makeRepo(
  overrides: Partial<jest.Mocked<CartRepository>> = {},
): jest.Mocked<CartRepository> {
  return {
    findByCustomerId: jest.fn().mockResolvedValue(null),
    findItemsForTaxPreview: jest.fn().mockResolvedValue([]),
    upsertCart: jest.fn().mockResolvedValue({ id: 'cart-1' }),
    findCartItem: jest.fn().mockResolvedValue(null),
    updateCartItemQuantity: jest.fn().mockResolvedValue(undefined),
    deleteCartItem: jest.fn().mockResolvedValue(undefined),
    clearCart: jest.fn().mockResolvedValue(undefined),
    findCartByCustomerId: jest.fn().mockResolvedValue({ id: 'cart-1' }),
    findCartItemById: jest.fn().mockResolvedValue(null),
    getAggregatedStock: jest.fn().mockResolvedValue(100),
    // Phase 196 (#10/#11) — batched stock (Map-like returning 100 for any
    // key, matching the legacy getAggregatedStock default) + activity touch.
    getAggregatedStockBatch: jest.fn().mockResolvedValue({ get: () => 100 }),
    touchLastActivity: jest.fn().mockResolvedValue(undefined),
    validateProduct: jest.fn().mockResolvedValue(true),
    validateVariant: jest.fn().mockResolvedValue(true),
    countActiveItemsForVariant: jest.fn().mockResolvedValue(0),
    countActiveItemsForProduct: jest.fn().mockResolvedValue(0),
    countCartItemsForCustomer: jest.fn().mockResolvedValue(0),
    deleteAbandonedCartsOlderThan: jest.fn().mockResolvedValue(0),
    incrementOrCreateCartItem: jest.fn().mockResolvedValue(undefined),
    setSavedForLater: jest.fn().mockResolvedValue(undefined),
    getListUnitPriceInPaise: jest.fn().mockResolvedValue(10000n),
    moveToCartIfStockAvailable: jest
      .fn()
      .mockResolvedValue({ moved: true, availableStock: 100 }),
    ...overrides,
  } as unknown as jest.Mocked<CartRepository>;
}

// ─── DTO validation (audit Gap #5) ────────────────────────────────────

describe('AddCartItemDto (Phase 61)', () => {
  it('rejects a non-UUID productId', async () => {
    const msgs = await dtoMessages(AddCartItemDto, { productId: 'not-a-uuid' });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects a non-UUID variantId', async () => {
    const msgs = await dtoMessages(AddCartItemDto, { productId: UUID, variantId: 'bad' });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects quantity < 1', async () => {
    const msgs = await dtoMessages(AddCartItemDto, { productId: UUID, quantity: 0 });
    expect(msgs.some((m) => m.includes('at least 1'))).toBe(true);
  });

  it('rejects quantity > 99 (per-line cap)', async () => {
    const msgs = await dtoMessages(AddCartItemDto, { productId: UUID, quantity: 100 });
    expect(msgs.some((m) => m.includes('99'))).toBe(true);
  });

  it('accepts a minimal valid payload', async () => {
    const msgs = await dtoMessages(AddCartItemDto, { productId: UUID });
    expect(msgs).toEqual([]);
  });
});

describe('UpdateCartItemDto (Phase 61 — Gap #6)', () => {
  it('rejects quantity = 0 with the "use DELETE" hint', async () => {
    const msgs = await dtoMessages(UpdateCartItemDto, { quantity: 0 });
    expect(msgs.some((m) => m.toLowerCase().includes('delete'))).toBe(true);
  });

  it('rejects negative quantity', async () => {
    const msgs = await dtoMessages(UpdateCartItemDto, { quantity: -5 });
    expect(msgs.some((m) => m.includes('at least 1'))).toBe(true);
  });

  it('accepts a positive quantity within cap', async () => {
    const msgs = await dtoMessages(UpdateCartItemDto, { quantity: 5 });
    expect(msgs).toEqual([]);
  });
});

describe('MergeCartDto (Phase 61)', () => {
  it('rejects empty items array', async () => {
    const msgs = await dtoMessages(MergeCartDto, { items: [] });
    expect(msgs.some((m) => m.toLowerCase().includes('empty'))).toBe(true);
  });

  it('rejects > 50 items per merge', async () => {
    const items = Array.from({ length: 51 }, () => ({
      productId: UUID,
      quantity: 1,
    }));
    const msgs = await dtoMessages(MergeCartDto, { items });
    expect(msgs.some((m) => m.includes('50'))).toBe(true);
  });

  it('rejects a non-UUID productId in an inner row', async () => {
    const msgs = await dtoMessages(MergeCartDto, {
      items: [{ productId: 'bad', quantity: 1 }],
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });
});

// ─── PATCH semantics (audit Gap #6) ───────────────────────────────────

describe('CartService.updateItem (Phase 61 — Gap #6)', () => {
  it('throws BadRequest when quantity <= 0 (defence-in-depth at service edge)', async () => {
    const repo = makeRepo({
      findCartItemById: jest
        .fn()
        .mockResolvedValue({ id: 'i-1', productId: UUID, variantId: null, quantity: 2 }),
    });
    const svc = new CartService(repo, {} as any);
    await expect(svc.updateItem('cust-1', 'i-1', 0)).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    await expect(svc.updateItem('cust-1', 'i-1', -3)).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(repo.updateCartItemQuantity).not.toHaveBeenCalled();
  });
});

// ─── Stock floor inside the primitive (audit Gap #7) ──────────────────

describe('CartService.addItem race-safe stock (Phase 61 — Gap #7)', () => {
  it('passes availableStock + price snapshot + cart-line cap to incrementOrCreateCartItem', async () => {
    const repo = makeRepo({
      getAggregatedStock: jest.fn().mockResolvedValue(5),
      getListUnitPriceInPaise: jest.fn().mockResolvedValue(19900n),
    });
    const svc = new CartService(repo, {} as any);
    await svc.addItem('cust-1', UUID, UUID2, 2);

    expect(repo.incrementOrCreateCartItem).toHaveBeenCalledWith(
      'cart-1',
      UUID,
      UUID2,
      2,
      expect.objectContaining({
        availableStock: 5,
        unitPriceInPaiseSnapshot: 19900n,
        cartLineCap: 50,
      }),
    );
  });

  it('maps INSUFFICIENT_STOCK from the repo to a 400 BadRequestAppException', async () => {
    const repo = makeRepo({
      incrementOrCreateCartItem: jest.fn().mockRejectedValue(
        Object.assign(new Error('Insufficient stock'), {
          code: 'INSUFFICIENT_STOCK',
        }),
      ),
    });
    const svc = new CartService(repo, {} as any);
    await expect(svc.addItem('cust-1', UUID, UUID2, 1)).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('maps CART_LINE_CAP from the repo to a 409 ConflictAppException', async () => {
    const repo = makeRepo({
      incrementOrCreateCartItem: jest.fn().mockRejectedValue(
        Object.assign(new Error('Cart has reached the 50-line limit'), {
          code: 'CART_LINE_CAP',
        }),
      ),
    });
    const svc = new CartService(repo, {} as any);
    await expect(svc.addItem('cust-1', UUID, UUID2, 1)).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });
});

// ─── getCart projection (audit Gaps #2, #9, #22) ──────────────────────

describe('CartService.getCart (Phase 61 — projection)', () => {
  function buildItem(over: Partial<any> = {}) {
    return {
      id: 'item-1',
      productId: UUID,
      variantId: UUID2,
      quantity: 1,
      savedForLater: false,
      unitPriceAtAddInPaise: 10000n,
      product: {
        id: UUID,
        title: 'Test Product',
        slug: 'test-product',
        basePrice: 100,
        baseStock: 50,
        baseSku: 'SKU-1',
        hasVariants: true,
        status: 'ACTIVE',
        isDeleted: false,
        images: [],
        seller: { id: 'seller-1', sellerName: 'Acme', sellerShopName: 'AcmeShop' },
      },
      variant: {
        id: UUID2,
        title: 'Red Large',
        price: 100,
        stock: 50,
        sku: 'SKU-1-RL',
        status: 'ACTIVE',
        isDeleted: false,
        images: [],
      },
      ...over,
    };
  }

  it('threads sellerShopName through every line (audit Gap #2)', async () => {
    const repo = makeRepo({
      findByCustomerId: jest
        .fn()
        .mockResolvedValue({ id: 'cart-1', customerId: 'cust-1', items: [buildItem()] }),
    });
    const svc = new CartService(repo, {} as any);
    const res = await svc.getCart('cust-1');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      sellerId: 'seller-1',
      sellerName: 'Acme',
      sellerShopName: 'AcmeShop',
    });
  });

  it('flags an archived product as unavailable and excludes it from the subtotal (audit Gap #9)', async () => {
    const archived = buildItem({
      product: { ...buildItem().product, status: 'ARCHIVED', isDeleted: false },
    });
    const repo = makeRepo({
      findByCustomerId: jest
        .fn()
        .mockResolvedValue({ id: 'cart-1', customerId: 'cust-1', items: [archived] }),
    });
    const svc = new CartService(repo, {} as any);
    const res = await svc.getCart('cust-1');
    expect(res.items[0]).toMatchObject({
      unavailable: true,
      unavailableReason: 'product_unavailable',
    });
    expect(res.totalAmount).toBe(0);
    expect(res.itemCount).toBe(0);
  });

  it('flags a soft-deleted variant as unavailable (audit Gap #9)', async () => {
    const deletedVariant = buildItem({
      variant: { ...buildItem().variant, isDeleted: true },
    });
    const repo = makeRepo({
      findByCustomerId: jest
        .fn()
        .mockResolvedValue({ id: 'cart-1', customerId: 'cust-1', items: [deletedVariant] }),
    });
    const svc = new CartService(repo, {} as any);
    const res = await svc.getCart('cust-1');
    expect(res.items[0]).toMatchObject({
      unavailable: true,
      unavailableReason: 'variant_unavailable',
    });
  });

  it('surfaces priceChanged=true when live price drifts from the snapshot (audit Gap #22)', async () => {
    // snapshot = 10000 paise; live variant price 150 → 15000 paise
    const drifted = buildItem({
      variant: { ...buildItem().variant, price: 150 },
    });
    const repo = makeRepo({
      findByCustomerId: jest
        .fn()
        .mockResolvedValue({ id: 'cart-1', customerId: 'cust-1', items: [drifted] }),
    });
    const svc = new CartService(repo, {} as any);
    const res = await svc.getCart('cust-1');
    expect(res.items[0]).toMatchObject({
      priceChanged: true,
      unitPriceAtAddInPaise: 10000,
      unitPrice: 150,
    });
  });

  it('surfaces priceChanged=false when live price matches the snapshot', async () => {
    const repo = makeRepo({
      findByCustomerId: jest
        .fn()
        .mockResolvedValue({ id: 'cart-1', customerId: 'cust-1', items: [buildItem()] }),
    });
    const svc = new CartService(repo, {} as any);
    const res = await svc.getCart('cust-1');
    expect(res.items[0]).toMatchObject({ priceChanged: false });
  });
});

// ─── mergeAnonymousCart (audit Gaps #15 + #19) ────────────────────────

describe('CartService.mergeAnonymousCart (Phase 61)', () => {
  it('parallelises and returns merged + skipped + per-item failure reasons', async () => {
    const repo = makeRepo({
      validateProduct: jest
        .fn()
        .mockImplementation(async (productId: string) => productId !== 'bad-product'),
    });
    const svc = new CartService(repo, {} as any);
    const res = await svc.mergeAnonymousCart('cust-1', [
      { productId: UUID, quantity: 1 },
      { productId: 'bad-product', quantity: 2 },
      { productId: UUID2, quantity: 1 },
    ]);
    expect(res.merged).toBe(2);
    expect(res.skipped).toBe(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toMatchObject({
      productId: 'bad-product',
      reason: expect.stringMatching(/not found/i),
    });
  });

  it('returns empty failures array on a fully-successful merge', async () => {
    const repo = makeRepo();
    const svc = new CartService(repo, {} as any);
    const res = await svc.mergeAnonymousCart('cust-1', [
      { productId: UUID, quantity: 1 },
      { productId: UUID2, quantity: 2 },
    ]);
    expect(res.merged).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.failures).toEqual([]);
  });
});

// ─── Abandonment sweep (audit Gap #12) ────────────────────────────────

describe('CartService.sweepAbandonedCarts (Phase 61 — Gap #12)', () => {
  it('delegates to repo.deleteAbandonedCartsOlderThan with the given cutoff', async () => {
    const repo = makeRepo({
      deleteAbandonedCartsOlderThan: jest.fn().mockResolvedValue(7),
    });
    const svc = new CartService(repo, {} as any);
    const cutoff = new Date('2026-01-01T00:00:00Z');
    const deleted = await svc.sweepAbandonedCarts(cutoff);
    expect(repo.deleteAbandonedCartsOlderThan).toHaveBeenCalledWith(cutoff);
    expect(deleted).toBe(7);
  });
});
