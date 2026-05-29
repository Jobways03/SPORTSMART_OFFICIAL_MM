/**
 * Phase 51 (2026-05-21) — repo-level integration spec for the new
 * methods added in Phase 51 + Phase 51 polish:
 *
 *   - bulkUpdateStockWithBefore — bulk update that returns
 *     before/after stockQty + reservedQty so the controller can write
 *     MANUAL_ADJUST ledger rows.
 *   - findManyByIdsForSeller — single batched ownership query
 *     replacing the pre-Phase-51 N findById loop.
 *   - softDelete — sets deletedAt + flips isActive to false.
 *   - updateWithRowLock — SELECT … FOR UPDATE inside $transaction so
 *     stockQty/reservedQty TOCTOU race fails atomically.
 *   - listStockMovementsForMapping — paginated ledger read for the
 *     seller-facing /history endpoint.
 *
 * The spec follows the same tx-mock pattern as the Phase 1
 * bulkUpdateStock spec — we never hit a real DB; we verify the
 * Prisma calls land with the expected shape and that the failure
 * branches throw the typed errors the controller relies on.
 */

import 'reflect-metadata';
import { PrismaSellerMappingRepository } from './prisma-seller-mapping.repository';
import { StockBelowReservedError } from '../../domain/errors/stock-below-reserved.error';

function buildPrisma(stubs: {
  $transaction?: jest.Mock;
  $queryRaw?: jest.Mock;
  sellerProductMapping?: {
    findMany?: jest.Mock;
    update?: jest.Mock;
    updateMany?: jest.Mock;
  };
  stockMovement?: { findMany?: jest.Mock };
}) {
  return {
    $transaction: stubs.$transaction ?? jest.fn(),
    $queryRaw: stubs.$queryRaw ?? jest.fn(),
    sellerProductMapping: {
      findMany: stubs.sellerProductMapping?.findMany ?? jest.fn(),
      update: stubs.sellerProductMapping?.update ?? jest.fn(),
      updateMany: stubs.sellerProductMapping?.updateMany ?? jest.fn(),
    },
    stockMovement: {
      findMany: stubs.stockMovement?.findMany ?? jest.fn().mockResolvedValue([]),
    },
  } as any;
}

describe('PrismaSellerMappingRepository.bulkUpdateStockWithBefore (Phase 51)', () => {
  it('returns before/after pairs for clean rows', async () => {
    const tx = {
      sellerProductMapping: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 'm-1', productId: 'p-1', variantId: 'v-1', stockQty: 5, reservedQty: 0 },
            { id: 'm-2', productId: 'p-2', variantId: null, stockQty: 0, reservedQty: 0 },
          ]),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
    };
    const prisma = buildPrisma({
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    });
    const repo = new PrismaSellerMappingRepository(prisma);

    const out = await repo.bulkUpdateStockWithBefore([
      { mappingId: 'm-1', stockQty: 10 },
      { mappingId: 'm-2', stockQty: 20 },
    ]);

    expect(out.updated).toHaveLength(2);
    expect(out.updated[0]).toEqual({
      id: 'm-1',
      productId: 'p-1',
      variantId: 'v-1',
      beforeStockQty: 5,
      afterStockQty: 10,
      reservedQty: 0,
    });
  });

  it('applies lowStockThreshold alongside stockQty when supplied (Gap #4)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      sellerProductMapping: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm-1', productId: 'p-1', variantId: null, stockQty: 5, reservedQty: 0 },
        ]),
        updateMany,
      },
    };
    const prisma = buildPrisma({ $transaction: jest.fn(async (fn: any) => fn(tx)) });
    const repo = new PrismaSellerMappingRepository(prisma);

    await repo.bulkUpdateStockWithBefore([
      { mappingId: 'm-1', stockQty: 10, lowStockThreshold: 2 },
    ]);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'm-1', reservedQty: { lte: 10 } },
      data: { stockQty: 10, lowStockThreshold: 2 },
    });
  });

  it('throws StockBelowReservedError listing all floor violations', async () => {
    const tx = {
      sellerProductMapping: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm-1', productId: 'p-1', variantId: null, stockQty: 5, reservedQty: 0 },
          { id: 'm-2', productId: 'p-2', variantId: null, stockQty: 5, reservedQty: 15 },
          { id: 'm-3', productId: 'p-3', variantId: null, stockQty: 5, reservedQty: 8 },
        ]),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })   // m-1 ok
          .mockResolvedValueOnce({ count: 0 })   // m-2 floor violation
          .mockResolvedValueOnce({ count: 0 }),  // m-3 floor violation
      },
    };
    const prisma = buildPrisma({ $transaction: jest.fn(async (fn: any) => fn(tx)) });
    const repo = new PrismaSellerMappingRepository(prisma);

    await expect(
      repo.bulkUpdateStockWithBefore([
        { mappingId: 'm-1', stockQty: 10 },
        { mappingId: 'm-2', stockQty: 5 },
        { mappingId: 'm-3', stockQty: 2 },
      ]),
    ).rejects.toThrow(StockBelowReservedError);
  });
});

describe('PrismaSellerMappingRepository.findManyByIdsForSeller (Phase 51)', () => {
  it('queries with id IN AND sellerId, selecting only ownership-relevant fields', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = buildPrisma({ sellerProductMapping: { findMany } });
    const repo = new PrismaSellerMappingRepository(prisma);

    await repo.findManyByIdsForSeller(['m-1', 'm-2'], 'seller-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['m-1', 'm-2'] }, sellerId: 'seller-1' },
      select: {
        id: true,
        sellerId: true,
        productId: true,
        variantId: true,
        stockQty: true,
        reservedQty: true,
        deletedAt: true,
      },
    });
  });
});

describe('PrismaSellerMappingRepository.softDelete (Phase 51)', () => {
  it('stamps deletedAt and flips isActive to false', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = buildPrisma({ sellerProductMapping: { update } });
    const repo = new PrismaSellerMappingRepository(prisma);

    await repo.softDelete('m-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        isActive: false,
      }),
    });
  });
});

describe('PrismaSellerMappingRepository.updateWithRowLock (Phase 51 polish)', () => {
  function txStub(opts: {
    locked: any[];
    update?: jest.Mock;
  }) {
    return {
      $queryRaw: jest.fn().mockResolvedValue(opts.locked),
      sellerProductMapping: {
        update: opts.update ?? jest.fn().mockResolvedValue({ id: 'm-1' }),
      },
    };
  }

  it('throws NOT_FOUND when SELECT FOR UPDATE returns no rows', async () => {
    const tx = txStub({ locked: [] });
    const prisma = buildPrisma({ $transaction: jest.fn(async (fn: any) => fn(tx)) });
    const repo = new PrismaSellerMappingRepository(prisma);

    await expect(
      repo.updateWithRowLock('m-ghost', 'seller-1', { stockQty: 5 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when the locked row is soft-deleted', async () => {
    const tx = txStub({
      locked: [
        {
          id: 'm-1',
          seller_id: 'seller-1',
          stock_qty: 10,
          reserved_qty: 0,
          deleted_at: new Date(),
        },
      ],
    });
    const prisma = buildPrisma({ $transaction: jest.fn(async (fn: any) => fn(tx)) });
    const repo = new PrismaSellerMappingRepository(prisma);

    await expect(
      repo.updateWithRowLock('m-1', 'seller-1', { stockQty: 5 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws FORBIDDEN when the locked row belongs to a different seller', async () => {
    const tx = txStub({
      locked: [
        {
          id: 'm-1',
          seller_id: 'OTHER',
          stock_qty: 10,
          reserved_qty: 0,
          deleted_at: null,
        },
      ],
    });
    const prisma = buildPrisma({ $transaction: jest.fn(async (fn: any) => fn(tx)) });
    const repo = new PrismaSellerMappingRepository(prisma);

    await expect(
      repo.updateWithRowLock('m-1', 'seller-1', { stockQty: 5 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws FLOOR_VIOLATION carrying requestedStock + reservedQty', async () => {
    const tx = txStub({
      locked: [
        {
          id: 'm-1',
          seller_id: 'seller-1',
          stock_qty: 10,
          reserved_qty: 7,
          deleted_at: null,
        },
      ],
    });
    const prisma = buildPrisma({ $transaction: jest.fn(async (fn: any) => fn(tx)) });
    const repo = new PrismaSellerMappingRepository(prisma);

    await expect(
      repo.updateWithRowLock('m-1', 'seller-1', { stockQty: 3 }),
    ).rejects.toMatchObject({
      code: 'FLOOR_VIOLATION',
      requestedStock: 3,
      reservedQty: 7,
    });
  });

  it('returns before/after pairs on the success path (stockQty change)', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'm-1',
      productId: 'p-1',
      variantId: null,
      stockQty: 12,
    });
    const tx = txStub({
      locked: [
        {
          id: 'm-1',
          seller_id: 'seller-1',
          stock_qty: 5,
          reserved_qty: 0,
          deleted_at: null,
        },
      ],
      update,
    });
    const prisma = buildPrisma({ $transaction: jest.fn(async (fn: any) => fn(tx)) });
    const repo = new PrismaSellerMappingRepository(prisma);

    const out = await repo.updateWithRowLock('m-1', 'seller-1', { stockQty: 12 });

    expect(out.before.stockQty).toBe(5);
    expect(out.after.stockQty).toBe(12);
    expect(update).toHaveBeenCalled();
  });

  it('passes when stockQty === reservedQty (zero-available boundary)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'm-1' });
    const tx = txStub({
      locked: [
        {
          id: 'm-1',
          seller_id: 'seller-1',
          stock_qty: 8,
          reserved_qty: 5,
          deleted_at: null,
        },
      ],
      update,
    });
    const prisma = buildPrisma({ $transaction: jest.fn(async (fn: any) => fn(tx)) });
    const repo = new PrismaSellerMappingRepository(prisma);

    await expect(
      repo.updateWithRowLock('m-1', 'seller-1', { stockQty: 5 }),
    ).resolves.toBeDefined();
  });

  it('opens exactly one $transaction for the whole flow', async () => {
    const tx = txStub({
      locked: [
        {
          id: 'm-1',
          seller_id: 'seller-1',
          stock_qty: 5,
          reserved_qty: 0,
          deleted_at: null,
        },
      ],
    });
    const transactionFn = jest.fn(async (fn: any) => fn(tx));
    const prisma = buildPrisma({ $transaction: transactionFn });
    const repo = new PrismaSellerMappingRepository(prisma);

    await repo.updateWithRowLock('m-1', 'seller-1', { stockQty: 12 });

    expect(transactionFn).toHaveBeenCalledTimes(1);
  });
});

describe('PrismaSellerMappingRepository.listStockMovementsForMapping (Phase 51 polish)', () => {
  it('queries by mappingId in descending createdAt with default pagination', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = buildPrisma({ stockMovement: { findMany } });
    const repo = new PrismaSellerMappingRepository(prisma);

    await repo.listStockMovementsForMapping('m-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { mappingId: 'm-1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 0,
    });
  });

  it('clamps limit to 200 max', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = buildPrisma({ stockMovement: { findMany } });
    const repo = new PrismaSellerMappingRepository(prisma);

    await repo.listStockMovementsForMapping('m-1', { limit: 99999 });

    expect(findMany.mock.calls[0][0].take).toBe(200);
  });

  it('floors limit to 1 min', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = buildPrisma({ stockMovement: { findMany } });
    const repo = new PrismaSellerMappingRepository(prisma);

    await repo.listStockMovementsForMapping('m-1', { limit: 0 });

    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it('floors offset to 0', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = buildPrisma({ stockMovement: { findMany } });
    const repo = new PrismaSellerMappingRepository(prisma);

    await repo.listStockMovementsForMapping('m-1', { offset: -5 });

    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });
});
