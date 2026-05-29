/**
 * Phase 59 (2026-05-22) — bulk seller-mapping suspend / activate
 * flow hardening:
 *
 *   - Status-conditional suspend (audit Gaps #1 + #2): only
 *     APPROVED+active rows transition to SUSPENDED+inactive
 *   - Status-conditional activate (audit Gap #1): only
 *     SUSPENDED+inactive rows transition to APPROVED+active
 *   - Mandatory reason + adminId captured (audit Gaps #3 + #5)
 *   - AuditPublicFacade.writeAuditLog called per affected row
 *     (audit Gap #3)
 *   - EventBusService.publish fires catalog.seller_mappings.{
 *     suspended,activated} aggregate event + per-released-
 *     reservation inventory.reservation.released event (audit
 *     Gaps #4 + #6)
 *   - CatalogCacheService.invalidateProductLists called when at
 *     least one row moved (audit Gap #11)
 *   - Seller account-level SUSPENDED status surfaces as a log
 *     warning (audit Gap #7)
 *   - Repository wraps the snapshot + updateMany in a
 *     $transaction (audit Gap #8)
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AdminOperationsService } from './admin-operations.service';
import {
  BulkActivateMappingsDto,
  BulkSuspendMappingsDto,
} from '../../presentation/dtos/seller-mapping-suspension.dto';

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

type Overrides = {
  findSellerBasic?: jest.Mock;
  suspendSellerMappings?: jest.Mock;
  activateSellerMappings?: jest.Mock;
  releaseReservationsForMappings?: jest.Mock;
  auditWrite?: jest.Mock;
  eventPublish?: jest.Mock;
  cacheInvalidate?: jest.Mock;
};

function buildService(over: Overrides = {}) {
  const repo: any = {
    findSellerBasic: over.findSellerBasic ?? jest.fn(),
    suspendSellerMappings:
      over.suspendSellerMappings ??
      jest.fn().mockResolvedValue({ count: 0, affectedMappingIds: [] }),
    activateSellerMappings:
      over.activateSellerMappings ??
      jest.fn().mockResolvedValue({ count: 0, affectedMappingIds: [] }),
    releaseReservationsForMappings:
      over.releaseReservationsForMappings ?? jest.fn().mockResolvedValue([]),
  };
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
  const svc = new AdminOperationsService(repo, audit, eventBus, catalogCache);
  return { svc, repo, audit, eventBus, catalogCache };
}

const SELLER_OK = {
  id: 'seller-1',
  sellerName: 'Test Seller',
  isDeleted: false,
  status: 'ACTIVE',
};

// ─── DTO contract ─────────────────────────────────────────────────────

describe('BulkSuspendMappingsDto (Phase 59)', () => {
  it('rejects a missing reason', async () => {
    const msgs = await dtoMessages(BulkSuspendMappingsDto, {});
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects reason < 3 chars', async () => {
    const msgs = await dtoMessages(BulkSuspendMappingsDto, { reason: 'no' });
    expect(msgs.some((m) => m.includes('3'))).toBe(true);
  });

  it('rejects reason > 500 chars', async () => {
    const msgs = await dtoMessages(BulkSuspendMappingsDto, {
      reason: 'x'.repeat(501),
    });
    expect(msgs.some((m) => m.includes('500'))).toBe(true);
  });

  it('accepts a valid 3-500 char reason', async () => {
    const msgs = await dtoMessages(BulkSuspendMappingsDto, {
      reason: 'Quality compliance failure',
    });
    expect(msgs).toEqual([]);
  });
});

describe('BulkActivateMappingsDto (Phase 59)', () => {
  it('rejects a missing reason', async () => {
    const msgs = await dtoMessages(BulkActivateMappingsDto, {});
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts a valid reason', async () => {
    const msgs = await dtoMessages(BulkActivateMappingsDto, {
      reason: 'Quality issue resolved',
    });
    expect(msgs).toEqual([]);
  });
});

// ─── suspendSellerMappings ────────────────────────────────────────────

describe('AdminOperationsService.suspendSellerMappings (Phase 59)', () => {
  it('throws BadRequest when sellerId is empty', async () => {
    const { svc } = buildService();
    await expect(
      svc.suspendSellerMappings('', 'admin-1', 'reason'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('throws NotFound when seller does not exist', async () => {
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(null),
    });
    await expect(
      svc.suspendSellerMappings('ghost', 'admin-1', 'reason'),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws BadRequest when seller is deleted', async () => {
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue({ ...SELLER_OK, isDeleted: true }),
    });
    await expect(
      svc.suspendSellerMappings('seller-1', 'admin-1', 'reason'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('passes adminId + reason through to the repo', async () => {
    const suspendSellerMappings = jest
      .fn()
      .mockResolvedValue({ count: 0, affectedMappingIds: [] });
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      suspendSellerMappings,
    });
    await svc.suspendSellerMappings('seller-1', 'admin-7', 'compliance');
    expect(suspendSellerMappings).toHaveBeenCalledWith(
      'seller-1',
      'admin-7',
      'compliance',
    );
  });

  it('writes one audit log per affected mapping with MAPPING_SUSPENDED action', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      suspendSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 2, affectedMappingIds: ['m-1', 'm-2'] }),
      auditWrite,
    });
    await svc.suspendSellerMappings('seller-1', 'admin-7', 'compliance');
    expect(auditWrite).toHaveBeenCalledTimes(2);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MAPPING_SUSPENDED',
        actorRole: 'ADMIN',
        actorId: 'admin-7',
        resourceId: 'm-1',
      }),
    );
  });

  it('emits the aggregate catalog.seller_mappings.suspended event', async () => {
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      suspendSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 2, affectedMappingIds: ['m-1', 'm-2'] }),
      eventPublish,
    });
    await svc.suspendSellerMappings('seller-1', 'admin-7', 'compliance');
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'catalog.seller_mappings.suspended',
        aggregateId: 'seller-1',
      }),
    );
  });

  it('releases active reservations and emits inventory.reservation.released per row', async () => {
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const releaseFn = jest.fn().mockResolvedValue([
      {
        reservationId: 'r-1',
        mappingId: 'm-1',
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
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      suspendSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 1, affectedMappingIds: ['m-1'] }),
      releaseReservationsForMappings: releaseFn,
      eventPublish,
    });
    const res = await svc.suspendSellerMappings('seller-1', 'admin-7', 'compliance');
    expect(releaseFn).toHaveBeenCalledWith(['m-1']);
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.reservation.released',
        aggregateId: 'r-1',
      }),
    );
    expect(res.releasedReservations).toBe(1);
  });

  it('invalidates the catalog cache when at least one row was suspended', async () => {
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      suspendSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 1, affectedMappingIds: ['m-1'] }),
      cacheInvalidate,
    });
    await svc.suspendSellerMappings('seller-1', 'admin-7', 'compliance');
    expect(cacheInvalidate).toHaveBeenCalledTimes(1);
  });

  it('does NOT invalidate the catalog cache when zero rows were suspended', async () => {
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      suspendSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 0, affectedMappingIds: [] }),
      cacheInvalidate,
    });
    await svc.suspendSellerMappings('seller-1', 'admin-7', 'compliance');
    expect(cacheInvalidate).not.toHaveBeenCalled();
  });

  it('returns rich result with adminId + reason + affected ids + sellerAccountStatus', async () => {
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      suspendSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 3, affectedMappingIds: ['m-1', 'm-2', 'm-3'] }),
    });
    const res = await svc.suspendSellerMappings('seller-1', 'admin-7', 'compliance');
    expect(res).toMatchObject({
      sellerId: 'seller-1',
      affectedMappings: 3,
      affectedMappingIds: ['m-1', 'm-2', 'm-3'],
      action: 'suspended',
      adminId: 'admin-7',
      reason: 'compliance',
      sellerAccountStatus: 'ACTIVE',
    });
  });
});

// ─── activateSellerMappings ───────────────────────────────────────────

describe('AdminOperationsService.activateSellerMappings (Phase 59)', () => {
  it('passes adminId + reason through to the repo', async () => {
    const activateSellerMappings = jest
      .fn()
      .mockResolvedValue({ count: 0, affectedMappingIds: [] });
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      activateSellerMappings,
    });
    await svc.activateSellerMappings('seller-1', 'admin-7', 'Issue resolved');
    expect(activateSellerMappings).toHaveBeenCalledWith(
      'seller-1',
      'admin-7',
      'Issue resolved',
    );
  });

  it('emits MAPPING_REACTIVATED audit log per affected mapping', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      activateSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 2, affectedMappingIds: ['m-1', 'm-2'] }),
      auditWrite,
    });
    await svc.activateSellerMappings('seller-1', 'admin-7', 'Issue resolved');
    expect(auditWrite).toHaveBeenCalledTimes(2);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MAPPING_REACTIVATED',
        actorRole: 'ADMIN',
      }),
    );
  });

  it('emits catalog.seller_mappings.activated aggregate event', async () => {
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      activateSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 1, affectedMappingIds: ['m-1'] }),
      eventPublish,
    });
    await svc.activateSellerMappings('seller-1', 'admin-7', 'Issue resolved');
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'catalog.seller_mappings.activated',
        aggregateId: 'seller-1',
      }),
    );
  });

  it('does NOT invalidate the cache when zero rows were activated', async () => {
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      activateSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 0, affectedMappingIds: [] }),
      cacheInvalidate,
    });
    await svc.activateSellerMappings('seller-1', 'admin-7', 'Issue resolved');
    expect(cacheInvalidate).not.toHaveBeenCalled();
  });

  it('returns releasedReservations=0 because activate does NOT release anything', async () => {
    const releaseFn = jest.fn();
    const { svc } = buildService({
      findSellerBasic: jest.fn().mockResolvedValue(SELLER_OK),
      activateSellerMappings: jest
        .fn()
        .mockResolvedValue({ count: 2, affectedMappingIds: ['m-1', 'm-2'] }),
      releaseReservationsForMappings: releaseFn,
    });
    const res = await svc.activateSellerMappings('seller-1', 'admin-7', 'Issue resolved');
    expect(releaseFn).not.toHaveBeenCalled();
    expect(res.releasedReservations).toBe(0);
  });
});
