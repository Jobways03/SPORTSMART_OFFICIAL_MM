import 'reflect-metadata';
import { PrismaCartRepository } from './prisma-cart.repository';

/**
 * Phase 1 (PR 1.9) — repository contract for the atomic add primitive.
 *
 * The service spec (cart.service.spec.ts) proves the public flow.
 * This spec pins the implementation contract on the repo side:
 *
 *   - opens a `prisma.$transaction(...)` (so all queries inside hold
 *     the same DB connection and see a consistent snapshot)
 *   - issues `SELECT ... FOR UPDATE` on the `carts` row keyed by the
 *     cartId (serialises concurrent add-item calls for one customer)
 *   - then does `findFirst` on cart_items, followed by either
 *     `update` (sum the quantity) or `create` (new line item)
 *
 * The unique constraint `@@unique([cartId, productId, variantId])`
 * does NOT cover the variantId=NULL case (Postgres treats NULL as
 * distinct), so the row lock is what guarantees no-duplicate for
 * base-product line items. For variant-bearing items the row lock
 * also prevents the racey-create P2002 error path.
 */

type TxLike = {
  $queryRaw: jest.Mock;
  cartItem: {
    findFirst: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
};

function buildTxMock(opts: {
  existing?: { id: string; quantity: number } | null;
} = {}): TxLike {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'cart-1' }]),
    cartItem: {
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function buildPrismaMock(tx: TxLike) {
  return {
    $transaction: jest.fn(async (fn: (tx: TxLike) => Promise<void>) => fn(tx)),
  } as any;
}

describe('PrismaCartRepository.incrementOrCreateCartItem (PR 1.9)', () => {
  it('opens a transaction (atomicity comes from the transaction boundary)', async () => {
    const tx = buildTxMock();
    const prisma = buildPrismaMock(tx);
    const repo = new PrismaCartRepository(prisma);

    await repo.incrementOrCreateCartItem('cart-1', 'prod-1', 'var-1', 2);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('takes a row lock on the cart via SELECT ... FOR UPDATE before reading the item row', async () => {
    const tx = buildTxMock();
    const prisma = buildPrismaMock(tx);
    const repo = new PrismaCartRepository(prisma);

    await repo.incrementOrCreateCartItem('cart-1', 'prod-1', 'var-1', 2);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [tmpl] = tx.$queryRaw.mock.calls[0];
    // `$queryRaw` is invoked with a tagged-template (TemplateStringsArray).
    // Join the raw strings and look for the lock clause.
    const rawSql = Array.isArray(tmpl) ? tmpl.join('?') : String(tmpl);
    expect(rawSql.toLowerCase()).toMatch(/for\s+update/);
    expect(rawSql.toLowerCase()).toMatch(/from\s+carts/);
  });

  it('on existing item: updates quantity to existing+delta inside the transaction', async () => {
    const tx = buildTxMock({ existing: { id: 'item-1', quantity: 4 } });
    const prisma = buildPrismaMock(tx);
    const repo = new PrismaCartRepository(prisma);

    await repo.incrementOrCreateCartItem('cart-1', 'prod-1', 'var-1', 3);

    expect(tx.cartItem.update).toHaveBeenCalledTimes(1);
    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { quantity: 7 },
    });
    expect(tx.cartItem.create).not.toHaveBeenCalled();
  });

  it('on missing item: creates a new cart_items row with the requested quantity', async () => {
    const tx = buildTxMock({ existing: null });
    const prisma = buildPrismaMock(tx);
    const repo = new PrismaCartRepository(prisma);

    await repo.incrementOrCreateCartItem('cart-1', 'prod-1', 'var-1', 5);

    expect(tx.cartItem.create).toHaveBeenCalledTimes(1);
    expect(tx.cartItem.create).toHaveBeenCalledWith({
      data: { cartId: 'cart-1', productId: 'prod-1', variantId: 'var-1', quantity: 5 },
    });
    expect(tx.cartItem.update).not.toHaveBeenCalled();
  });

  it('passes variantId=null through to findFirst and create (base-product line)', async () => {
    const tx = buildTxMock({ existing: null });
    const prisma = buildPrismaMock(tx);
    const repo = new PrismaCartRepository(prisma);

    await repo.incrementOrCreateCartItem('cart-1', 'prod-1', null, 2);

    expect(tx.cartItem.findFirst).toHaveBeenCalledWith({
      where: { cartId: 'cart-1', productId: 'prod-1', variantId: null },
    });
    expect(tx.cartItem.create).toHaveBeenCalledWith({
      data: { cartId: 'cart-1', productId: 'prod-1', variantId: null, quantity: 2 },
    });
  });

  it('throws if the cart row does not exist (caller forgot upsertCart)', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      cartItem: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    } as TxLike;
    const prisma = buildPrismaMock(tx);
    const repo = new PrismaCartRepository(prisma);

    await expect(
      repo.incrementOrCreateCartItem('missing-cart', 'prod-1', 'var-1', 1),
    ).rejects.toThrow(/cart/i);

    expect(tx.cartItem.findFirst).not.toHaveBeenCalled();
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(tx.cartItem.update).not.toHaveBeenCalled();
  });
});
