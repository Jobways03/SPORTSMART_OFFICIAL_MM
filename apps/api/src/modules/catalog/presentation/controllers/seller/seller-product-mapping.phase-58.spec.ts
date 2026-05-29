/**
 * Phase 58 (2026-05-22) — pins the seller-side STOP-flow audit gap
 * closures:
 *
 *   - PATCH no longer copies `isActive` into the update payload
 *     (audit Gaps #3 + #9). A seller who smuggles {isActive:false}
 *     past validation gets it dropped at the controller's allowlist
 *     loop.
 *   - New POST /seller/catalog/mapping/:id/pause endpoint goes
 *     through the same status-conditional STOPPED transition as
 *     admin /stop. Reason mandatory (3-500 chars). Re-activation
 *     requires admin /reapprove — there is no seller /resume.
 *   - Pause releases active reservations + writes RELEASED ledger
 *     rows + fires inventory.reservation.released event (audit Gap
 *     #8).
 *   - Pause audit log carries actorRole='SELLER' so a forensic
 *     query distinguishes seller-pause from admin-stop on the same
 *     stoppedBy column.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../../core/exceptions';
import { SellerProductMappingController } from './seller-product-mapping.controller';
import { SellerPauseMappingDto } from './dtos/seller-mapping.dto';

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
} as any;

type Overrides = {
  findById?: jest.Mock;
  stop?: jest.Mock;
  releaseActiveReservationsForMapping?: jest.Mock;
  updateWithRowLock?: jest.Mock;
  auditWrite?: jest.Mock;
  eventPublish?: jest.Mock;
  cacheInvalidate?: jest.Mock;
  ledgerRecord?: jest.Mock;
};

function buildController(over: Overrides = {}) {
  const sellerMappingRepo: any = {
    findById: over.findById ?? jest.fn(),
    stop: over.stop ?? jest.fn(),
    releaseActiveReservationsForMapping:
      over.releaseActiveReservationsForMapping ?? jest.fn().mockResolvedValue([]),
    updateWithRowLock: over.updateWithRowLock ?? jest.fn(),
    findManyByIdsForSeller: jest.fn().mockResolvedValue([]),
    resubmit: jest.fn(),
    findBySellerForProduct: jest.fn().mockResolvedValue([]),
    createMany: jest.fn(),
    findProductForMapping: jest.fn(),
    findVariantForMapping: jest.fn(),
    findPostOfficeByPincode: jest.fn(),
    findBySellerAndProduct: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    bulkUpdateStockWithBefore: jest.fn(),
    softDelete: jest.fn(),
    listStockMovementsForMapping: jest.fn(),
    autoRepairMissingMappingsForSeller: jest.fn().mockResolvedValue(0),
  };
  const storefrontRepo: any = {};
  const stockSyncService: any = { syncVariantStockFromMappings: jest.fn() };
  const stockLedger: any = {
    record: over.ledgerRecord ?? jest.fn().mockResolvedValue(undefined),
  };
  const redis: any = { acquireLock: jest.fn().mockResolvedValue(false) };
  const audit: any = {
    writeAuditLog: over.auditWrite ?? jest.fn().mockResolvedValue(undefined),
  };
  const eventBus: any = {
    publish: over.eventPublish ?? jest.fn().mockResolvedValue(undefined),
  };
  const catalogCache: any = {
    invalidateProductLists:
      over.cacheInvalidate ?? jest.fn().mockResolvedValue(undefined),
  };
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
  return { sellerId };
}

const APPROVED = {
  id: 'm-1',
  sellerId: 'seller-1',
  productId: 'p-1',
  variantId: null,
  approvalStatus: 'APPROVED',
  isActive: true,
  deletedAt: null,
  stockQty: 10,
  reservedQty: 0,
};

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

// ─── DTO contract ─────────────────────────────────────────────────────

describe('SellerPauseMappingDto (Phase 58)', () => {
  it('rejects a missing reason', async () => {
    const msgs = await dtoMessages(SellerPauseMappingDto, {});
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects reason < 3 chars', async () => {
    const msgs = await dtoMessages(SellerPauseMappingDto, { reason: 'no' });
    expect(msgs.some((m) => m.includes('3'))).toBe(true);
  });

  it('rejects reason > 500 chars', async () => {
    const msgs = await dtoMessages(SellerPauseMappingDto, {
      reason: 'x'.repeat(501),
    });
    expect(msgs.some((m) => m.includes('500'))).toBe(true);
  });

  it('accepts a valid reason', async () => {
    const msgs = await dtoMessages(SellerPauseMappingDto, {
      reason: 'Inventory recount in progress',
    });
    expect(msgs).toEqual([]);
  });
});

// ─── PATCH isActive blocked ───────────────────────────────────────────

describe('updateMapping (Phase 58 — isActive dropped at allowlist)', () => {
  it('does NOT copy isActive into the update payload even if smuggled past validation', async () => {
    const updateWithRowLock = jest.fn().mockResolvedValue({
      row: { id: 'm-1', productId: 'p-1', variantId: null, stockQty: 5 },
      before: { stockQty: 5, reservedQty: 0 },
      after: { stockQty: 5, reservedQty: 0 },
    });
    const ctrl = buildController({ updateWithRowLock });

    await ctrl.updateMapping(req(), 'm-1', {
      stockQty: 5,
      isActive: false,
    } as any);

    const writtenData = updateWithRowLock.mock.calls[0][2];
    expect(writtenData.stockQty).toBe(5);
    expect(writtenData).not.toHaveProperty('isActive');
  });
});

// ─── /pause endpoint ──────────────────────────────────────────────────

describe('pauseMapping (Phase 58 — Gaps #3 + #9)', () => {
  it('throws NotFound when the mapping does not exist', async () => {
    const ctrl = buildController({ findById: jest.fn().mockResolvedValue(null) });
    await expect(
      ctrl.pauseMapping(req(), 'm-ghost', { reason: 'inventory recount' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws NotFound on a soft-deleted mapping', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...APPROVED, deletedAt: new Date() }),
    });
    await expect(
      ctrl.pauseMapping(req(), 'm-1', { reason: 'inventory recount' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws Forbidden when the mapping belongs to another seller', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...APPROVED, sellerId: 'OTHER' }),
    });
    await expect(
      ctrl.pauseMapping(req('seller-1'), 'm-1', { reason: 'inventory recount' }),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('throws 400 when the mapping is not APPROVED (repo.stop returns null)', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...APPROVED, approvalStatus: 'PENDING_APPROVAL' }),
      stop: jest.fn().mockResolvedValue(null),
    });
    await expect(
      ctrl.pauseMapping(req(), 'm-1', { reason: 'inventory recount' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('calls repo.stop with sellerId + prefixed reason and releases reservations', async () => {
    const stop = jest.fn().mockResolvedValue({
      ...APPROVED,
      approvalStatus: 'STOPPED',
      isActive: false,
    });
    const releaseFn = jest.fn().mockResolvedValue([
      {
        reservationId: 'r-1',
        quantity: 2,
        orderId: 'o-1',
        customerId: null,
        sessionId: null,
        cartId: null,
        stockQty: 10,
        beforeReservedQty: 2,
        afterReservedQty: 0,
      },
    ]);
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);

    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue(APPROVED),
      stop,
      releaseActiveReservationsForMapping: releaseFn,
      auditWrite,
      eventPublish,
      cacheInvalidate,
      ledgerRecord,
    });

    const res = await ctrl.pauseMapping(req('seller-1'), 'm-1', {
      reason: 'Inventory recount in progress',
    });

    // Reason is prefixed with [SellerPause] so admin can distinguish.
    expect(stop).toHaveBeenCalledWith(
      'm-1',
      'seller-1',
      expect.stringContaining('[SellerPause]'),
    );
    // Reservation release runs and ledger fires for r-1.
    expect(releaseFn).toHaveBeenCalledWith('m-1');
    expect(ledgerRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'RELEASED',
        referenceType: 'MAPPING_STOPPED',
        actorRole: 'SELLER',
      }),
    );
    // Audit log carries actorRole='SELLER' so forensic queries can
    // tell seller-pause from admin-stop on the stoppedBy column.
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRole: 'SELLER',
        action: 'MAPPING_STOPPED',
        resource: 'SellerProductMapping',
      }),
    );
    // Per-reservation released event + the catalog event.
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.reservation.released',
        aggregateId: 'r-1',
      }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'catalog.seller_mapping.stopped',
      }),
    );
    expect(cacheInvalidate).toHaveBeenCalledTimes(1);
    expect((res as any).data.releasedReservations).toBe(1);
  });
});
