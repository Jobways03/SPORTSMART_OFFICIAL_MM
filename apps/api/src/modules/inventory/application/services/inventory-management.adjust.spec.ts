/**
 * Phase 53 (2026-05-21) — locks the row-locked adjust contract:
 *   - reason required at the service layer (defence behind the DTO)
 *   - SELECT FOR UPDATE row lock on the mapping
 *   - floor check inside the lock surfaces a ConflictAppException
 *   - ownership check rejects cross-seller adjustments
 *   - StockMovement ledger row written for every successful change
 *   - adjustForAdmin sets actorRole='ADMIN' + kind passthrough
 *   - importStockBySku writes a per-row ledger entry
 */

import { StockMovementKind } from '@prisma/client';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { InventoryManagementService } from './inventory-management.service';

function makeService() {
  const repo: any = {
    findMappingById: jest.fn(),
    updateMappingStock: jest.fn(),
    setMappingStockQty: jest.fn(),
    findVariantsByMasterSkus: jest.fn().mockResolvedValue([]),
    findProductsByProductCodes: jest.fn().mockResolvedValue([]),
    findSellerMappingByProductVariant: jest.fn(),
    findMovementsByMappingId: jest.fn().mockResolvedValue({ movements: [], total: 0 }),
    findAllActiveMappings: jest.fn().mockResolvedValue([]),
  };
  const franchiseFacade: any = {};
  const prisma: any = {
    $queryRaw: jest.fn(),
    sellerProductMapping: { update: jest.fn() },
    $transaction: jest.fn(async (fn: any) => {
      const tx = {
        $queryRaw: prisma.$queryRaw,
        sellerProductMapping: prisma.sellerProductMapping,
      };
      return fn(tx);
    }),
  };
  const ledger: any = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new InventoryManagementService(repo, franchiseFacade, prisma, ledger);
  return { service, repo, prisma, ledger };
}

describe('InventoryManagementService.adjustStock (Phase 53)', () => {
  it('throws BadRequest on adjustment=0', async () => {
    const { service } = makeService();
    await expect(
      service.adjustStock('m-1', 0, 'seller-1', { reason: 'whatever' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('throws BadRequest when reason is missing', async () => {
    const { service } = makeService();
    await expect(
      service.adjustStock('m-1', 5, 'seller-1', { reason: '' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('throws NotFound when the row lock returns empty', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.adjustStock('m-ghost', 5, 'seller-1', { reason: 'why' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws Forbidden when sellerId mismatches the locked row', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'm-1', seller_id: 'OTHER', stock_qty: 10, reserved_qty: 0 },
    ]);
    await expect(
      service.adjustStock('m-1', 5, 'seller-1', { reason: 'why' }),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('throws Conflict when the resulting stock would dip below reservedQty (inside-lock floor)', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'm-1', seller_id: 'seller-1', stock_qty: 10, reserved_qty: 7 },
    ]);
    await expect(
      service.adjustStock('m-1', -5, 'seller-1', { reason: 'why' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('throws BadRequest when newStockQty would go negative', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'm-1', seller_id: 'seller-1', stock_qty: 3, reserved_qty: 0 },
    ]);
    await expect(
      service.adjustStock('m-1', -5, 'seller-1', { reason: 'why' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('writes a MANUAL_ADJUST ledger row with actorRole=SELLER on success', async () => {
    const { service, prisma, ledger } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'm-1', seller_id: 'seller-1', stock_qty: 10, reserved_qty: 2 },
    ]);
    prisma.sellerProductMapping.update.mockResolvedValueOnce({
      id: 'm-1',
      stockQty: 15,
      reservedQty: 2,
    });

    await service.adjustStock('m-1', 5, 'seller-1', {
      reason: 'Physical count reconciliation',
      actorId: 'seller-1',
      actorRole: 'SELLER',
    });

    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'SellerProductMapping',
        resourceId: 'm-1',
        kind: StockMovementKind.MANUAL_ADJUST,
        quantityDelta: 5,
        beforeStockQty: 10,
        afterStockQty: 15,
        beforeReservedQty: 2,
        afterReservedQty: 2,
        actorId: 'seller-1',
        actorRole: 'SELLER',
        reason: 'Physical count reconciliation',
      }),
    );
  });

  it('returns the updated stock state on success', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'm-1', seller_id: 'seller-1', stock_qty: 10, reserved_qty: 2 },
    ]);
    prisma.sellerProductMapping.update.mockResolvedValueOnce({
      id: 'm-1',
      stockQty: 7,
      reservedQty: 2,
    });

    const out = await service.adjustStock('m-1', -3, 'seller-1', {
      reason: 'Damage write-off',
    });

    expect(out).toEqual({
      id: 'm-1',
      stockQty: 7,
      reservedQty: 2,
      availableStock: 5,
    });
  });
});

describe('InventoryManagementService.adjustForAdmin (Phase 53)', () => {
  it('delegates with actorRole=ADMIN and skips sellerId ownership check', async () => {
    const { service, prisma, ledger } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'm-1', seller_id: 'seller-1', stock_qty: 10, reserved_qty: 0 },
    ]);
    prisma.sellerProductMapping.update.mockResolvedValueOnce({
      id: 'm-1',
      stockQty: 5,
      reservedQty: 0,
    });

    await service.adjustForAdmin('m-1', -5, 'Admin correction', 'admin-1');

    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRole: 'ADMIN',
        actorId: 'admin-1',
        kind: StockMovementKind.MANUAL_ADJUST,
      }),
    );
  });

  it('passes the admin-selected kind through to the ledger', async () => {
    const { service, prisma, ledger } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'm-1', seller_id: 'seller-1', stock_qty: 10, reserved_qty: 0 },
    ]);
    prisma.sellerProductMapping.update.mockResolvedValueOnce({
      id: 'm-1',
      stockQty: 7,
      reservedQty: 0,
    });

    await service.adjustForAdmin(
      'm-1',
      -3,
      'Storeroom water damage',
      'admin-1',
      StockMovementKind.WRITE_OFF,
    );

    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: StockMovementKind.WRITE_OFF }),
    );
  });
});

describe('InventoryManagementService.getMappingMovementsForSeller (Phase 53)', () => {
  it('throws Forbidden when the mapping belongs to another seller', async () => {
    const { service, repo } = makeService();
    repo.findMappingById.mockResolvedValueOnce({ id: 'm-1', sellerId: 'OTHER' });

    await expect(
      service.getMappingMovementsForSeller('seller-1', 'm-1', 1, 50),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('throws NotFound when the mapping does not exist', async () => {
    const { service, repo } = makeService();
    repo.findMappingById.mockResolvedValueOnce(null);
    await expect(
      service.getMappingMovementsForSeller('seller-1', 'm-ghost', 1, 50),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('returns the ledger rows when the seller owns the mapping', async () => {
    const { service, repo } = makeService();
    // getMappingMovementsForSeller calls findMappingById ONCE for the
    // ownership check; then delegates to getMappingMovements which
    // also calls findMappingById internally.
    repo.findMappingById.mockResolvedValue({ id: 'm-1', sellerId: 'seller-1' });
    repo.findMovementsByMappingId.mockResolvedValueOnce({
      movements: [{ id: 'mv-1', kind: 'MANUAL_ADJUST' }],
      total: 1,
    });

    const out = await service.getMappingMovementsForSeller('seller-1', 'm-1', 1, 50);
    expect(out.total).toBe(1);
    expect(out.movements).toHaveLength(1);
  });
});

describe('InventoryManagementService.importStockBySku (Phase 53)', () => {
  it('rejects when reason is missing', async () => {
    const { service } = makeService();
    await expect(
      service.importStockBySku('seller-1', [{ masterSku: 'X', stockQty: 1 }], ''),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('writes a ledger row per successfully imported item', async () => {
    const { service, repo, prisma, ledger } = makeService();
    repo.findVariantsByMasterSkus.mockResolvedValueOnce([
      { id: 'v-1', masterSku: 'A', productId: 'p-1' },
    ]);
    repo.findSellerMappingByProductVariant.mockResolvedValueOnce({
      id: 'm-1',
      productId: 'p-1',
      variantId: 'v-1',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ stock_qty: 10, reserved_qty: 0 }]);
    prisma.sellerProductMapping.update.mockResolvedValueOnce(undefined);

    await service.importStockBySku(
      'seller-1',
      [{ masterSku: 'A', stockQty: 20 }],
      'Monthly count',
      'seller-1',
    );

    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: StockMovementKind.MANUAL_ADJUST,
        beforeStockQty: 10,
        afterStockQty: 20,
        quantityDelta: 10,
        referenceType: 'BULK_IMPORT',
        actorId: 'seller-1',
        actorRole: 'SELLER',
      }),
    );
  });

  it('skips ledger when stockQty is unchanged (no delta)', async () => {
    const { service, repo, prisma, ledger } = makeService();
    repo.findVariantsByMasterSkus.mockResolvedValueOnce([
      { id: 'v-1', masterSku: 'A', productId: 'p-1' },
    ]);
    repo.findSellerMappingByProductVariant.mockResolvedValueOnce({
      id: 'm-1',
      productId: 'p-1',
      variantId: 'v-1',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ stock_qty: 20, reserved_qty: 0 }]);
    prisma.sellerProductMapping.update.mockResolvedValueOnce(undefined);

    await service.importStockBySku(
      'seller-1',
      [{ masterSku: 'A', stockQty: 20 }],
      'No-op import',
    );

    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('records a skipped reason when the row would go below reservedQty', async () => {
    const { service, repo, prisma } = makeService();
    repo.findVariantsByMasterSkus.mockResolvedValueOnce([
      { id: 'v-1', masterSku: 'A', productId: 'p-1' },
    ]);
    repo.findSellerMappingByProductVariant.mockResolvedValueOnce({
      id: 'm-1',
      productId: 'p-1',
      variantId: 'v-1',
    });
    prisma.$queryRaw.mockResolvedValueOnce([{ stock_qty: 10, reserved_qty: 8 }]);

    const out = await service.importStockBySku(
      'seller-1',
      [{ masterSku: 'A', stockQty: 5 }],
      'Monthly count',
    );

    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]?.reason).toMatch(/reservedQty/);
  });
});
