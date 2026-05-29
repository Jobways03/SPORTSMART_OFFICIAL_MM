/**
 * Phase 58 (2026-05-22) — pins the seller-mapping STOP-flow audit
 * gap closures:
 *
 *   - Stop is APPROVED-only (audit Gap #13). PENDING_APPROVAL is
 *     routed to /reject; STOPPED to /reapprove.
 *   - Stop reason is mandatory at the DTO layer (audit Gap #5).
 *   - Active reservations on the mapping are released, ledger rows
 *     written, and `inventory.reservation.released` events fired
 *     (audit Gap #8).
 *   - New POST /admin/seller-mappings/bulk/stop with per-row
 *     outcomes + per-row side effects (audit Gap #17).
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestAppException } from '../../../../../core/exceptions';
import { AdminSellerMappingsController } from './admin-seller-mappings.controller';
import {
  BulkStopDto,
  StopMappingDto,
} from './dtos/admin-seller-mapping.dto';

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  setContext: jest.fn(),
} as any;

type CtrlOverrides = {
  findById?: jest.Mock;
  stop?: jest.Mock;
  bulkStop?: jest.Mock;
  releaseActiveReservationsForMapping?: jest.Mock;
  auditWrite?: jest.Mock;
  eventPublish?: jest.Mock;
  cacheInvalidate?: jest.Mock;
  ledgerRecord?: jest.Mock;
};

function buildController(over: CtrlOverrides = {}) {
  const productRepo: any = {};
  const sellerMappingRepo: any = {
    findById: over.findById ?? jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    stop: over.stop ?? jest.fn(),
    reapprove: jest.fn(),
    bulkApprove: jest.fn(),
    bulkStop: over.bulkStop ?? jest.fn(),
    releaseActiveReservationsForMapping:
      over.releaseActiveReservationsForMapping ?? jest.fn().mockResolvedValue([]),
    findManyByIdsForSeller: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };
  const stockSyncService: any = { syncVariantStockFromMappings: jest.fn() };
  const stockLedger: any = {
    record: over.ledgerRecord ?? jest.fn().mockResolvedValue(undefined),
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
  const redis: any = { acquireLock: jest.fn().mockResolvedValue(false) };
  return new AdminSellerMappingsController(
    productRepo,
    sellerMappingRepo,
    noopLogger,
    stockSyncService,
    stockLedger,
    audit,
    eventBus,
    catalogCache,
    redis,
  );
}

function req(adminId = 'admin-7'): any {
  return { adminId };
}

const APPROVED = {
  id: 'm-1',
  productId: 'p-1',
  variantId: null,
  sellerId: 'seller-1',
  approvalStatus: 'APPROVED',
  isActive: true,
  pickupPincode: '400001',
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

// ─── DTO contracts ─────────────────────────────────────────────────────

describe('StopMappingDto (Phase 58 — Gap #5 reason mandatory)', () => {
  it('rejects a missing reason', async () => {
    const msgs = await dtoMessages(StopMappingDto, {});
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects a reason shorter than 3 characters', async () => {
    const msgs = await dtoMessages(StopMappingDto, { reason: 'no' });
    expect(msgs.some((m) => m.includes('3'))).toBe(true);
  });

  it('rejects a reason longer than 500 characters', async () => {
    const msgs = await dtoMessages(StopMappingDto, {
      reason: 'a'.repeat(501),
    });
    expect(msgs.some((m) => m.includes('500'))).toBe(true);
  });

  it('accepts a 3-500 character reason', async () => {
    const msgs = await dtoMessages(StopMappingDto, {
      reason: 'Quality issue flagged by QA',
    });
    expect(msgs).toEqual([]);
  });
});

describe('BulkStopDto (Phase 58 — Gap #17)', () => {
  it('rejects an empty mappingIds array', async () => {
    const msgs = await dtoMessages(BulkStopDto, { mappingIds: [], reason: 'sweep' });
    expect(msgs.some((m) => m.toLowerCase().includes('empty'))).toBe(true);
  });

  it('rejects > 100 mappings per call', async () => {
    const ids = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const msgs = await dtoMessages(BulkStopDto, {
      mappingIds: ids,
      reason: 'compliance sweep',
    });
    expect(msgs.some((m) => m.includes('100'))).toBe(true);
  });

  it('rejects a non-UUID mappingId', async () => {
    const msgs = await dtoMessages(BulkStopDto, {
      mappingIds: ['not-a-uuid'],
      reason: 'compliance sweep',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects when reason is missing', async () => {
    const msgs = await dtoMessages(BulkStopDto, {
      mappingIds: ['00000000-0000-4000-8000-000000000001'],
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts a valid 1-row batch with reason', async () => {
    const msgs = await dtoMessages(BulkStopDto, {
      mappingIds: ['00000000-0000-4000-8000-000000000001'],
      reason: 'compliance sweep',
    });
    expect(msgs).toEqual([]);
  });
});

// ─── Single-mapping stop ───────────────────────────────────────────────

describe('stopMapping state-guard (Phase 58 — Gap #13 APPROVED only)', () => {
  it('throws 400 with /reject hint when the mapping is PENDING_APPROVAL', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...APPROVED, approvalStatus: 'PENDING_APPROVAL' }),
      stop: jest.fn().mockResolvedValue(null),
    });
    await expect(
      ctrl.stopMapping(req(), 'm-1', { reason: 'compliance' }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/reject/i),
    });
  });

  it('throws 400 with "already stopped" hint when the mapping is STOPPED', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...APPROVED, approvalStatus: 'STOPPED' }),
      stop: jest.fn().mockResolvedValue(null),
    });
    await expect(
      ctrl.stopMapping(req(), 'm-1', { reason: 'compliance' }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/already stopped/i),
    });
  });

  it('throws 400 when the mapping is REJECTED', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...APPROVED, approvalStatus: 'REJECTED' }),
      stop: jest.fn().mockResolvedValue(null),
    });
    await expect(
      ctrl.stopMapping(req(), 'm-1', { reason: 'compliance' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('stopMapping reservation release (Phase 58 — Gap #8)', () => {
  it('releases active reservations + writes RELEASED ledger rows + emits per-reservation events', async () => {
    const releaseFn = jest.fn().mockResolvedValue([
      {
        reservationId: 'r-1',
        quantity: 2,
        orderId: 'o-1',
        customerId: 'c-1',
        sessionId: null,
        cartId: null,
        stockQty: 50,
        beforeReservedQty: 5,
        afterReservedQty: 3,
      },
      {
        reservationId: 'r-2',
        quantity: 1,
        orderId: null,
        customerId: null,
        sessionId: 'sess-1',
        cartId: 'cart-1',
        stockQty: 50,
        beforeReservedQty: 3,
        afterReservedQty: 2,
      },
    ]);
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue(APPROVED),
      stop: jest.fn().mockResolvedValue({
        ...APPROVED,
        approvalStatus: 'STOPPED',
        isActive: false,
      }),
      releaseActiveReservationsForMapping: releaseFn,
      ledgerRecord,
      eventPublish,
    });

    const res = await ctrl.stopMapping(req('admin-7'), 'm-1', {
      reason: 'Compliance escalation',
    });

    expect(releaseFn).toHaveBeenCalledWith('m-1');
    // 1 audit log + 2 RELEASED ledger rows = 3 ledger.record calls total
    // for ledger; ledger writes only fire for released rows here.
    expect(ledgerRecord).toHaveBeenCalledTimes(2);
    expect(ledgerRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'RELEASED',
        referenceType: 'MAPPING_STOPPED',
        actorRole: 'ADMIN',
      }),
    );
    // Per-reservation released event + the catalog.seller_mapping.stopped event = 3 publishes
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.reservation.released',
        aggregateId: 'r-1',
      }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.reservation.released',
        aggregateId: 'r-2',
      }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'catalog.seller_mapping.stopped' }),
    );
    expect((res as any).data.releasedReservations).toBe(2);
  });

  it('still succeeds when there are no active reservations', async () => {
    const releaseFn = jest.fn().mockResolvedValue([]);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue(APPROVED),
      stop: jest.fn().mockResolvedValue({
        ...APPROVED,
        approvalStatus: 'STOPPED',
        isActive: false,
      }),
      releaseActiveReservationsForMapping: releaseFn,
    });

    const res = await ctrl.stopMapping(req(), 'm-1', { reason: 'no-reservations case' });
    expect(releaseFn).toHaveBeenCalledWith('m-1');
    expect((res as any).data.releasedReservations).toBe(0);
  });

  it('swallows reservation-release failures and still completes the stop', async () => {
    const releaseFn = jest.fn().mockRejectedValue(new Error('DB down'));
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue(APPROVED),
      stop: jest.fn().mockResolvedValue({
        ...APPROVED,
        approvalStatus: 'STOPPED',
        isActive: false,
      }),
      releaseActiveReservationsForMapping: releaseFn,
    });

    const res = await ctrl.stopMapping(req(), 'm-1', { reason: 'failure path' });
    expect((res as any).success).toBe(true);
    expect((res as any).data.releasedReservations).toBe(0);
  });
});

// ─── Bulk stop ─────────────────────────────────────────────────────────

describe('bulkStopMappings (Phase 58 — Gap #17)', () => {
  it('returns per-row outcomes and fires audit + event + ledger only for successful rows', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const findById = jest
      .fn()
      .mockResolvedValueOnce({ ...APPROVED, id: 'm-1' })
      .mockResolvedValueOnce({ ...APPROVED, id: 'm-2', approvalStatus: 'STOPPED' });
    const bulkStop = jest.fn().mockResolvedValue([
      { mappingId: 'm-1', ok: true },
      {
        mappingId: 'm-2',
        ok: false,
        reason: 'Mapping is STOPPED, not APPROVED',
      },
    ]);
    const releaseActiveReservationsForMapping = jest
      .fn()
      .mockResolvedValueOnce([
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

    const ctrl = buildController({
      findById,
      bulkStop,
      releaseActiveReservationsForMapping,
      auditWrite,
      eventPublish,
      cacheInvalidate,
      ledgerRecord,
    });

    const res = await ctrl.bulkStopMappings(req('admin-7'), {
      mappingIds: ['m-1', 'm-2'],
      reason: 'compliance sweep',
    });

    expect(bulkStop).toHaveBeenCalledWith(
      ['m-1', 'm-2'],
      'admin-7',
      'compliance sweep',
    );
    expect((res as any).data.results).toHaveLength(2);
    expect((res as any).message).toMatch(/1 of 2/);
    // Audit fires once for the ok row only.
    expect(auditWrite).toHaveBeenCalledTimes(1);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MAPPING_STOPPED' }),
    );
    // catalog.seller_mapping.stopped event for ok row + inventory.reservation.released for r-1.
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'catalog.seller_mapping.stopped',
        aggregateId: 'm-1',
      }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.reservation.released',
        aggregateId: 'r-1',
      }),
    );
    // Release fires for the ok row only.
    expect(releaseActiveReservationsForMapping).toHaveBeenCalledTimes(1);
    expect(releaseActiveReservationsForMapping).toHaveBeenCalledWith('m-1');
    // Cache invalidates once after the loop.
    expect(cacheInvalidate).toHaveBeenCalledTimes(1);
    expect((res as any).data.releasedReservations).toBe(1);
  });

  it('does NOT invalidate the catalog cache when zero rows succeed', async () => {
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue(null),
      bulkStop: jest.fn().mockResolvedValue([
        { mappingId: 'm-1', ok: false, reason: 'Mapping is STOPPED, not APPROVED' },
      ]),
      cacheInvalidate,
    });
    await ctrl.bulkStopMappings(req(), {
      mappingIds: ['m-1'],
      reason: 'compliance sweep',
    });
    expect(cacheInvalidate).not.toHaveBeenCalled();
  });
});
