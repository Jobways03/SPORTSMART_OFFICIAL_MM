import 'reflect-metadata';
import { CartService } from './cart.service';
import { CartRepository } from '../../domain/repositories/cart.repository.interface';

/**
 * Phase 1 (PR 1.9) — Cart add-item atomicity.
 *
 * The pre-PR flow was:
 *
 *   const existing = await cartRepo.findCartItem(cart.id, productId, variantId);
 *   if (existing) await cartRepo.updateCartItemQuantity(existing.id, ...);
 *   else          await cartRepo.addCartItem(cart.id, ...);
 *
 * Two open issues:
 *
 *   (1) Read-then-write TOCTOU. A customer who double-clicks "add"
 *       under load can land both requests on different replicas; both
 *       findFirst → null, both addCartItem → two rows for the same
 *       (cartId, productId, variantId).
 *
 *   (2) Postgres treats NULL as distinct in compound unique indexes,
 *       so the schema's `@@unique([cartId, productId, variantId])`
 *       does NOT protect the no-variant case. The variant case throws
 *       P2002 on concurrent create — also bad: the second request
 *       errors instead of merging.
 *
 * PR 1.9 collapses the two-step write into a single repository call
 * `incrementOrCreateCartItem(...)` that the repo implements as a
 * transaction with `SELECT FOR UPDATE` on the cart row. This serialises
 * all add-item ops for one customer's cart — by the time the second
 * concurrent request gets the row lock, the first one's row already
 * exists and the second updates it (sums the quantity).
 *
 * This spec verifies the service uses the atomic primitive. The repo
 * spec verifies the lock/find/update-or-create wiring.
 */

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

function makeRepo(overrides: Partial<CartRepository> = {}): jest.Mocked<CartRepository> {
  return {
    findByCustomerId: jest.fn().mockResolvedValue(null),
    upsertCart: jest.fn().mockResolvedValue({ id: 'cart-1' }),
    findCartItem: jest.fn().mockResolvedValue(null),
    addCartItem: jest.fn().mockResolvedValue(undefined),
    updateCartItemQuantity: jest.fn().mockResolvedValue(undefined),
    deleteCartItem: jest.fn().mockResolvedValue(undefined),
    clearCart: jest.fn().mockResolvedValue(undefined),
    findCartByCustomerId: jest.fn().mockResolvedValue({ id: 'cart-1' }),
    findCartItemById: jest.fn().mockResolvedValue(null),
    getAggregatedStock: jest.fn().mockResolvedValue(100),
    validateProduct: jest.fn().mockResolvedValue(true),
    validateVariant: jest.fn().mockResolvedValue(true),
    countActiveItemsForVariant: jest.fn().mockResolvedValue(0),
    countActiveItemsForProduct: jest.fn().mockResolvedValue(0),
    // PR 1.9 — new atomic primitive
    incrementOrCreateCartItem: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as jest.Mocked<CartRepository>;
}

describe('CartService.addItem (PR 1.9 — atomicity)', () => {
  it('delegates the find+create/update step to incrementOrCreateCartItem (atomic)', async () => {
    const repo = makeRepo();
    const svc = new CartService(repo);

    await svc.addItem('cust-1', 'prod-1', 'var-1', 3);

    expect(repo.incrementOrCreateCartItem).toHaveBeenCalledTimes(1);
    expect(repo.incrementOrCreateCartItem).toHaveBeenCalledWith(
      'cart-1',
      'prod-1',
      'var-1',
      3,
    );
  });

  it('passes variantId=null when no variant is given', async () => {
    const repo = makeRepo();
    const svc = new CartService(repo);

    await svc.addItem('cust-1', 'prod-1', undefined, 2);

    expect(repo.incrementOrCreateCartItem).toHaveBeenCalledWith(
      'cart-1',
      'prod-1',
      null,
      2,
    );
  });

  it('does NOT call the non-atomic findCartItem+addCartItem/updateCartItemQuantity pair on the write path', async () => {
    // Guard against a future refactor reintroducing the racey pair.
    // We intentionally still allow findCartItem to be invoked for the
    // pre-write stock check (existingQty), but the create/update side
    // must go through the atomic primitive only.
    const repo = makeRepo();
    const svc = new CartService(repo);

    await svc.addItem('cust-1', 'prod-1', 'var-1', 1);

    expect(repo.addCartItem).not.toHaveBeenCalled();
    expect(repo.updateCartItemQuantity).not.toHaveBeenCalled();
  });

  it('still validates product/variant existence before the atomic write', async () => {
    const repo = makeRepo({
      validateProduct: jest.fn().mockResolvedValue(false),
    });
    const svc = new CartService(repo);

    await expect(
      svc.addItem('cust-1', 'prod-missing', 'var-1', 1),
    ).rejects.toThrow(/Product not found/);

    expect(repo.incrementOrCreateCartItem).not.toHaveBeenCalled();
  });

  it('still rejects quantity < 1 before any repo call', async () => {
    const repo = makeRepo();
    const svc = new CartService(repo);

    await expect(svc.addItem('cust-1', 'prod-1', 'var-1', 0)).rejects.toThrow(
      /at least 1/,
    );
    expect(repo.upsertCart).not.toHaveBeenCalled();
    expect(repo.incrementOrCreateCartItem).not.toHaveBeenCalled();
  });

  it('still enforces aggregated stock against existing-in-cart + requested', async () => {
    const repo = makeRepo({
      getAggregatedStock: jest.fn().mockResolvedValue(5),
      findCartByCustomerId: jest.fn().mockResolvedValue({ id: 'cart-1' }),
      findCartItem: jest.fn().mockResolvedValue({ id: 'item-1', quantity: 3 }),
    });
    const svc = new CartService(repo);

    // existing=3, requested=3, available=5 → reject (would exceed by 1)
    await expect(svc.addItem('cust-1', 'prod-1', 'var-1', 3)).rejects.toThrow(
      /Insufficient stock/,
    );
    expect(repo.incrementOrCreateCartItem).not.toHaveBeenCalled();
  });
});
