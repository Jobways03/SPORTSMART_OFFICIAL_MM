/**
 * Phase 196 (Cart Drawer audit) — genuine remediations (most of the audit
 * was stale: Phase 61/44/64/41 already did DTOs/throttle/idempotency/price-
 * snapshot/variant-status/onDelete/merge-cap/caps). This locks:
 *   #3  validateProduct rejects non-APPROVED moderation
 *   #17 count methods exclude saved-for-later lines
 *   #10 getAggregatedStockBatch single grouped aggregate
 *   #16 updateItem maps the in-lock INSUFFICIENT_STOCK error + touches activity
 *   #14 getCart subtotal exact in integer paise
 *   #11 mutations refresh lastActivityAt
 */
import { PrismaCartRepository } from './infrastructure/repositories/prisma-cart.repository';
import { CartService } from './application/services/cart.service';
import { CartRepository } from './domain/repositories/cart.repository.interface';

describe('PrismaCartRepository — Phase 196', () => {
  it('#3 validateProduct requires moderationStatus APPROVED', async () => {
    const prisma: any = { product: { findFirst: jest.fn().mockResolvedValue(null) } };
    const repo = new PrismaCartRepository(prisma);
    await repo.validateProduct('p1');
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'ACTIVE', isDeleted: false, moderationStatus: 'APPROVED' },
    });
  });

  it('#17 countActiveItemsForVariant excludes saved-for-later', async () => {
    const prisma: any = { cartItem: { count: jest.fn().mockResolvedValue(0) } };
    const repo = new PrismaCartRepository(prisma);
    await repo.countActiveItemsForVariant('v1');
    expect(prisma.cartItem.count).toHaveBeenCalledWith({
      where: { variantId: 'v1', savedForLater: false },
    });
  });

  it('#17 countActiveItemsForProduct excludes saved-for-later', async () => {
    const prisma: any = { cartItem: { count: jest.fn().mockResolvedValue(0) } };
    const repo = new PrismaCartRepository(prisma);
    await repo.countActiveItemsForProduct('p1');
    expect(prisma.cartItem.count).toHaveBeenCalledWith({
      where: { productId: 'p1', variantId: null, savedForLater: false },
    });
  });

  it('#10 getAggregatedStockBatch returns available per key (stock − reserved)', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([{ productId: 'p1', variantId: 'v1', _sum: { stockQty: 10, reservedQty: 3 } }])
      .mockResolvedValueOnce([{ productId: 'p2', _sum: { stockQty: 5, reservedQty: 0 } }]);
    // franchiseAvailableBatch runs raw SUM queries; no franchise stock here.
    const prisma: any = { sellerProductMapping: { groupBy }, $queryRaw: jest.fn().mockResolvedValue([]) };
    const repo = new PrismaCartRepository(prisma);
    const map = await repo.getAggregatedStockBatch([
      { productId: 'p1', variantId: 'v1' },
      { productId: 'p2', variantId: null },
    ]);
    expect(map.get('p1:v1')).toBe(7);
    expect(map.get('p2:null')).toBe(5);
    expect(groupBy).toHaveBeenCalledTimes(2);
  });

  it('#10 empty input does not query', async () => {
    const groupBy = jest.fn();
    const repo = new PrismaCartRepository({ sellerProductMapping: { groupBy } } as any);
    const map = await repo.getAggregatedStockBatch([]);
    expect(map.size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });
});

// ─── Service: error mapping + activity touch ──────────────────────────

function makeRepo(over: Partial<Record<keyof CartRepository, any>> = {}): jest.Mocked<CartRepository> {
  return {
    findByCustomerId: jest.fn().mockResolvedValue(null),
    findItemsForTaxPreview: jest.fn().mockResolvedValue([]),
    upsertCart: jest.fn().mockResolvedValue({ id: 'cart-1' }),
    touchLastActivity: jest.fn().mockResolvedValue(undefined),
    findCartItem: jest.fn().mockResolvedValue(null),
    updateCartItemQuantity: jest.fn().mockResolvedValue(undefined),
    deleteCartItem: jest.fn().mockResolvedValue(undefined),
    clearCart: jest.fn().mockResolvedValue(undefined),
    findCartByCustomerId: jest.fn().mockResolvedValue({ id: 'cart-1' }),
    findCartItemById: jest.fn().mockResolvedValue({ id: 'i1', productId: 'p1', variantId: null, quantity: 1 }),
    getAggregatedStock: jest.fn().mockResolvedValue(100),
    getAggregatedStockBatch: jest.fn().mockResolvedValue(new Map()),
    validateProduct: jest.fn().mockResolvedValue(true),
    validateVariant: jest.fn().mockResolvedValue(true),
    countActiveItemsForVariant: jest.fn().mockResolvedValue(0),
    countActiveItemsForProduct: jest.fn().mockResolvedValue(0),
    countCartItemsForCustomer: jest.fn().mockResolvedValue(0),
    deleteAbandonedCartsOlderThan: jest.fn().mockResolvedValue(0),
    incrementOrCreateCartItem: jest.fn().mockResolvedValue(undefined),
    setSavedForLater: jest.fn().mockResolvedValue(undefined),
    getListUnitPriceInPaise: jest.fn().mockResolvedValue(10000n),
    moveToCartIfStockAvailable: jest.fn().mockResolvedValue({ moved: true, availableStock: 100 }),
    ...over,
  } as unknown as jest.Mocked<CartRepository>;
}

describe('CartService — Phase 196', () => {
  it('#16 maps the repo INSUFFICIENT_STOCK error to a 400 on updateItem', async () => {
    const repo = makeRepo({
      updateCartItemQuantity: jest.fn().mockRejectedValue(
        Object.assign(new Error('Insufficient stock. Available: 2, Requested: 5'), {
          code: 'INSUFFICIENT_STOCK',
        }),
      ),
    });
    const svc = new CartService(repo, {} as any);
    await expect(svc.updateItem('cust-1', 'i1', 5)).rejects.toMatchObject({
      message: expect.stringContaining('Insufficient stock'),
    });
  });

  it('#16 passes cartId + product/variant into the locked update + touches activity', async () => {
    const repo = makeRepo();
    const svc = new CartService(repo, {} as any);
    await svc.updateItem('cust-1', 'i1', 3);
    expect(repo.updateCartItemQuantity).toHaveBeenCalledWith('i1', 'cart-1', 'p1', null, 3);
    expect(repo.touchLastActivity).toHaveBeenCalledWith('cart-1');
  });

  it('#11 removeItem + clearCart refresh lastActivityAt', async () => {
    const repo = makeRepo();
    const svc = new CartService(repo, {} as any);
    await svc.removeItem('cust-1', 'i1');
    await svc.clearCart('cust-1');
    expect(repo.touchLastActivity).toHaveBeenCalledTimes(2);
  });

  it('#14 getCart returns an exact integer-paise subtotal string', async () => {
    const repo = makeRepo({
      findByCustomerId: jest.fn().mockResolvedValue({
        id: 'cart-1',
        customerId: 'cust-1',
        items: [
          {
            id: 'i1', productId: 'p1', variantId: null, quantity: 3, savedForLater: false,
            unitPriceAtAddInPaise: null,
            product: { id: 'p1', title: 'T', slug: 't', basePrice: 99.99, baseStock: 5, baseSku: 'S', hasVariants: false, status: 'ACTIVE', isDeleted: false, images: [], seller: null },
            variant: null,
          },
        ],
      }),
      getAggregatedStockBatch: jest.fn().mockResolvedValue({ get: () => 100 }),
    });
    const svc = new CartService(repo, {} as any);
    const out: any = await svc.getCart('cust-1');
    // 99.99 → 9999 paise × 3 = 29997 paise = ₹299.97 (no float drift)
    expect(out.totalAmountInPaise).toBe('29997');
    expect(out.totalAmount).toBeCloseTo(299.97, 2);
  });
});
