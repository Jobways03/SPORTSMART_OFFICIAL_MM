import 'reflect-metadata';
import { SellerProductMappingController } from './seller-product-mapping.controller';
import { StockBelowReservedError } from '../../../domain/errors/stock-below-reserved.error';

/**
 * Phase 1 (PR 1.10) — controller-side handling of the stock floor.
 * Phase 51 (2026-05-21) — updated for the new constructor that adds
 * StockMovementLedgerService + RedisService, and the new
 * bulkUpdateStockWithBefore repo method that returns before/after
 * stockQty for ledger writes.
 *
 * Verifies:
 *   - On a clean bulk update, the controller returns the updated rows
 *     and writes one MANUAL_ADJUST ledger row per delta.
 *   - On StockBelowReservedError, the controller renders a 400 that
 *     enumerates every offending mapping.
 *   - The single-mapping PATCH path also rejects stock below reserved.
 *   - Ownership verification is a SINGLE batched query (Phase 51
 *     replaces the pre-Phase-51 N findById loop).
 */

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
} as any;

type Overrides = {
  findById?: jest.Mock;
  findManyByIdsForSeller?: jest.Mock;
  bulkUpdateStockWithBefore?: jest.Mock;
  update?: jest.Mock;
  updateWithRowLock?: jest.Mock;
  softDelete?: jest.Mock;
  listStockMovementsForMapping?: jest.Mock;
  syncVariantStockFromMappings?: jest.Mock;
  ledgerRecord?: jest.Mock;
  redisAcquireLock?: jest.Mock;
};

function buildController(overrides: Overrides = {}) {
  const sellerMappingRepo: any = {
    findById: overrides.findById ?? jest.fn(),
    findManyByIdsForSeller:
      overrides.findManyByIdsForSeller ?? jest.fn().mockResolvedValue([]),
    bulkUpdateStockWithBefore:
      overrides.bulkUpdateStockWithBefore ?? jest.fn(),
    update: overrides.update ?? jest.fn(),
    updateWithRowLock: overrides.updateWithRowLock ?? jest.fn(),
    softDelete: overrides.softDelete ?? jest.fn(),
    listStockMovementsForMapping:
      overrides.listStockMovementsForMapping ?? jest.fn().mockResolvedValue([]),
    findPostOfficeByPincode: jest.fn(),
    autoRepairMissingMappingsForSeller: jest.fn().mockResolvedValue(0),
  };
  const storefrontRepo: any = {};
  const stockSyncService: any = {
    syncVariantStockFromMappings:
      overrides.syncVariantStockFromMappings ?? jest.fn(),
  };
  const stockLedger: any = {
    record: overrides.ledgerRecord ?? jest.fn().mockResolvedValue(undefined),
  };
  const redis: any = {
    acquireLock: overrides.redisAcquireLock ?? jest.fn().mockResolvedValue(false),
  };
  // Phase 58 (2026-05-22) — audit/event/cache deps wired into the
  // constructor for the new /pause endpoint; the existing spec
  // surface (bulk stock / row-locked update / delete / history)
  // doesn't exercise them, so default no-op mocks keep it green.
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const catalogCache: any = { invalidateProductLists: jest.fn().mockResolvedValue(undefined) };
  return new SellerProductMappingController(
    sellerMappingRepo,
    storefrontRepo,
    noopLogger,
    stockSyncService,
    stockLedger,
    redis,
    audit,
    eventBus,
    catalogCache,
  );
}

function req(sellerId = 'seller-1'): any {
  return { sellerId } as any;
}

describe('SellerProductMappingController.bulkStockUpdate (Phase 51)', () => {
  it('clean batch — returns rows and writes one ledger entry per delta', async () => {
    const owned = [
      { id: 'm-1', sellerId: 'seller-1', productId: 'p-1', variantId: 'v-1', stockQty: 5, reservedQty: 0, deletedAt: null },
      { id: 'm-2', sellerId: 'seller-1', productId: 'p-2', variantId: null, stockQty: 0, reservedQty: 0, deletedAt: null },
    ];
    const updated = [
      { id: 'm-1', productId: 'p-1', variantId: 'v-1', beforeStockQty: 5, afterStockQty: 10, reservedQty: 0 },
      { id: 'm-2', productId: 'p-2', variantId: null, beforeStockQty: 0, afterStockQty: 20, reservedQty: 0 },
    ];
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findManyByIdsForSeller: jest.fn().mockResolvedValue(owned),
      bulkUpdateStockWithBefore: jest.fn().mockResolvedValue({ updated }),
      ledgerRecord,
    });

    const res = await ctrl.bulkStockUpdate(req(), {
      updates: [
        { mappingId: 'm-1', stockQty: 10 },
        { mappingId: 'm-2', stockQty: 20 },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(2);
    expect(ledgerRecord).toHaveBeenCalledTimes(2);
    expect(ledgerRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'SellerProductMapping',
        kind: 'MANUAL_ADJUST',
        beforeStockQty: 5,
        afterStockQty: 10,
        actorId: 'seller-1',
      }),
    );
  });

  it('skips ledger writes for no-op rows (before === after)', async () => {
    const owned = [{ id: 'm-1', sellerId: 'seller-1', productId: 'p-1', variantId: null, stockQty: 5, reservedQty: 0, deletedAt: null }];
    const updated = [{ id: 'm-1', productId: 'p-1', variantId: null, beforeStockQty: 5, afterStockQty: 5, reservedQty: 0 }];
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findManyByIdsForSeller: jest.fn().mockResolvedValue(owned),
      bulkUpdateStockWithBefore: jest.fn().mockResolvedValue({ updated }),
      ledgerRecord,
    });

    await ctrl.bulkStockUpdate(req(), { updates: [{ mappingId: 'm-1', stockQty: 5 }] });
    expect(ledgerRecord).not.toHaveBeenCalled();
  });

  it('floor violation — translates StockBelowReservedError to 400 listing every row', async () => {
    const owned = [
      { id: 'm-1', sellerId: 'seller-1', productId: 'p-1', variantId: 'v-1', stockQty: 10, reservedQty: 0, deletedAt: null },
      { id: 'm-2', sellerId: 'seller-1', productId: 'p-2', variantId: 'v-2', stockQty: 5, reservedQty: 15, deletedAt: null },
      { id: 'm-3', sellerId: 'seller-1', productId: 'p-3', variantId: 'v-3', stockQty: 2, reservedQty: 8, deletedAt: null },
    ];
    const ctrl = buildController({
      findManyByIdsForSeller: jest.fn().mockResolvedValue(owned),
      bulkUpdateStockWithBefore: jest.fn().mockRejectedValue(
        new StockBelowReservedError([
          { mappingId: 'm-2', requestedStock: 5, reservedQty: 15 },
          { mappingId: 'm-3', requestedStock: 2, reservedQty: 8 },
        ]),
      ),
    });

    await expect(
      ctrl.bulkStockUpdate(req(), {
        updates: [
          { mappingId: 'm-1', stockQty: 10 },
          { mappingId: 'm-2', stockQty: 5 },
          { mappingId: 'm-3', stockQty: 2 },
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/m-2.*requested 5.*reserved 15/),
    });
  });

  it('rejects when any mapping is not owned by the seller (single batched query)', async () => {
    // The repo returns only the rows owned by this seller — fewer than
    // mappingIds.length signals a non-owned id was in the payload.
    const ctrl = buildController({
      findManyByIdsForSeller: jest.fn().mockResolvedValue([
        { id: 'm-1', sellerId: 'seller-1', productId: 'p-1', variantId: null, stockQty: 5, reservedQty: 0, deletedAt: null },
      ]),
    });

    await expect(
      ctrl.bulkStockUpdate(req(), {
        updates: [
          { mappingId: 'm-1', stockQty: 10 },
          { mappingId: 'm-other-seller', stockQty: 20 },
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/m-other-seller/),
    });
  });

  it('rejects updates targeting a soft-deleted mapping', async () => {
    const ctrl = buildController({
      findManyByIdsForSeller: jest.fn().mockResolvedValue([
        { id: 'm-1', sellerId: 'seller-1', productId: 'p-1', variantId: null, stockQty: 5, reservedQty: 0, deletedAt: new Date() },
      ]),
    });

    await expect(
      ctrl.bulkStockUpdate(req(), { updates: [{ mappingId: 'm-1', stockQty: 10 }] }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/deleted/i),
    });
  });
});

describe('SellerProductMappingController.updateMapping (Phase 51 polish — row-locked path)', () => {
  it('rejects stockQty < reservedQty (FLOOR_VIOLATION thrown from inside the lock)', async () => {
    const updateWithRowLock = jest.fn().mockRejectedValue(
      Object.assign(new Error('FLOOR_VIOLATION'), {
        code: 'FLOOR_VIOLATION',
        requestedStock: 3,
        reservedQty: 7,
      }),
    );
    const ctrl = buildController({ updateWithRowLock });

    await expect(
      ctrl.updateMapping(req(), 'm-1', { stockQty: 3 } as any),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/cannot be less than reservedQty \(7\)/),
    });
  });

  it('translates NOT_FOUND from the repo to NotFoundAppException', async () => {
    const ctrl = buildController({
      updateWithRowLock: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' })),
    });

    await expect(
      ctrl.updateMapping(req(), 'm-ghost', { stockQty: 5 } as any),
    ).rejects.toMatchObject({ message: 'Mapping not found' });
  });

  it('translates FORBIDDEN from the repo to ForbiddenAppException', async () => {
    const ctrl = buildController({
      updateWithRowLock: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })),
    });

    await expect(
      ctrl.updateMapping(req(), 'm-1', { stockQty: 5 } as any),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/permission/i),
    });
  });

  it('writes a MANUAL_ADJUST ledger entry when stockQty changes', async () => {
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      updateWithRowLock: jest.fn().mockResolvedValue({
        row: { id: 'm-1', productId: 'p-1', variantId: null, stockQty: 12 },
        before: { stockQty: 5, reservedQty: 0 },
        after: { stockQty: 12, reservedQty: 0 },
      }),
      ledgerRecord,
    });

    await ctrl.updateMapping(req(), 'm-1', { stockQty: 12 } as any);

    expect(ledgerRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MANUAL_ADJUST',
        beforeStockQty: 5,
        afterStockQty: 12,
        actorId: 'seller-1',
      }),
    );
  });

  it('does NOT write a ledger entry when stockQty is unchanged (other fields only)', async () => {
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      updateWithRowLock: jest.fn().mockResolvedValue({
        row: { id: 'm-1' },
        before: { stockQty: 5, reservedQty: 0 },
        after: { stockQty: 5, reservedQty: 0 },
      }),
      ledgerRecord,
    });

    await ctrl.updateMapping(req(), 'm-1', { lowStockThreshold: 3 } as any);
    expect(ledgerRecord).not.toHaveBeenCalled();
  });

  it('still catches Prisma P2010 as a 409 (defense-in-depth backstop)', async () => {
    const ctrl = buildController({
      updateWithRowLock: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('reserved_qty constraint violation'), { code: 'P2010' }),
        ),
    });

    await expect(
      ctrl.updateMapping(req(), 'm-1', { stockQty: 3 } as any),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/concurrent reservation/i),
    });
  });
});

describe('SellerProductMappingController.stockHistory (Phase 51 polish)', () => {
  it('rejects when the mapping does not exist', async () => {
    const ctrl = buildController({ findById: jest.fn().mockResolvedValue(null) });

    await expect(
      ctrl.stockHistory(req(), 'm-1', undefined, undefined),
    ).rejects.toMatchObject({ message: 'Mapping not found' });
  });

  it('rejects when the mapping belongs to another seller', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ id: 'm-1', sellerId: 'OTHER' }),
    });

    await expect(
      ctrl.stockHistory(req(), 'm-1', undefined, undefined),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/permission/i),
    });
  });

  it('returns the ledger rows when the seller owns the mapping', async () => {
    const movements = [
      { id: 'mv-1', kind: 'MANUAL_ADJUST', beforeStockQty: 5, afterStockQty: 10 },
      { id: 'mv-2', kind: 'INITIAL', beforeStockQty: 0, afterStockQty: 5 },
    ];
    const list = jest.fn().mockResolvedValue(movements);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ id: 'm-1', sellerId: 'seller-1' }),
      listStockMovementsForMapping: list,
    });

    const res = await ctrl.stockHistory(req(), 'm-1', '20', '5');
    expect(res.success).toBe(true);
    expect(res.data).toEqual(movements);
    expect(list).toHaveBeenCalledWith('m-1', { limit: 20, offset: 5 });
  });
});

describe('SellerProductMappingController.deleteMapping (Phase 51)', () => {
  it('refuses to delete a mapping with reservedQty > 0', async () => {
    const softDelete = jest.fn();
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1', sellerId: 'seller-1', productId: 'p-1', variantId: null, reservedQty: 3, stockQty: 10, deletedAt: null,
      }),
      softDelete,
    });

    await expect(ctrl.deleteMapping(req(), 'm-1')).rejects.toMatchObject({
      message: expect.stringMatching(/reserved/i),
    });
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('soft-deletes (no hard delete) when reservedQty=0 and writes a ledger entry', async () => {
    const softDelete = jest.fn().mockResolvedValue(undefined);
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1', sellerId: 'seller-1', productId: 'p-1', variantId: null, reservedQty: 0, stockQty: 10, deletedAt: null,
      }),
      softDelete,
      ledgerRecord,
    });

    await ctrl.deleteMapping(req(), 'm-1');

    expect(softDelete).toHaveBeenCalledWith('m-1');
    expect(ledgerRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MANUAL_ADJUST',
        beforeStockQty: 10,
        afterStockQty: 0,
        reason: 'Seller deleted mapping',
      }),
    );
  });

  it('refuses delete on an already-soft-deleted mapping', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1', sellerId: 'seller-1', reservedQty: 0, deletedAt: new Date(),
      }),
    });

    await expect(ctrl.deleteMapping(req(), 'm-1')).rejects.toMatchObject({
      message: 'Mapping not found',
    });
  });
});
