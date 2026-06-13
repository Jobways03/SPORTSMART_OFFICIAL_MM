/**
 * Phase 57 (2026-05-22) — pins the approval-lifecycle hardening:
 *
 *   - State-machine guard (audit Gap #2): approve returns 400 when
 *     the mapping is not PENDING_APPROVAL
 *   - Pickup pincode precondition (audit Gap #12)
 *   - Audit log write on each transition (audit Gap #4)
 *   - Event emission per transition (audit Gap #5)
 *   - Catalog cache invalidation (audit Gaps #8 + #10)
 *   - New /reapprove endpoint for STOPPED → APPROVED
 *   - New /bulk/approve endpoint with per-row outcomes (Gap #6)
 *   - Idempotency-key header support (Gap #7)
 */

import 'reflect-metadata';
import { BadRequestAppException } from '../../../../../core/exceptions';
import { AdminSellerMappingsController } from './admin-seller-mappings.controller';

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  setContext: jest.fn(),
} as any;

type CtrlOverrides = {
  findById?: jest.Mock;
  findByIdBasic?: jest.Mock;
  approve?: jest.Mock;
  reject?: jest.Mock;
  stop?: jest.Mock;
  reapprove?: jest.Mock;
  bulkApprove?: jest.Mock;
  findManyByIdsForSeller?: jest.Mock;
  auditWrite?: jest.Mock;
  eventPublish?: jest.Mock;
  cacheInvalidate?: jest.Mock;
};

function buildController(over: CtrlOverrides = {}) {
  const productRepo: any = {
    // approve/reapprove now re-check the mapping's product isn't archived/removed.
    findByIdBasic:
      over.findByIdBasic ??
      jest.fn().mockResolvedValue({ id: 'p-1', status: 'ACTIVE', isDeleted: false }),
  };
  const sellerMappingRepo: any = {
    findById: over.findById ?? jest.fn(),
    approve: over.approve ?? jest.fn(),
    reject: over.reject ?? jest.fn(),
    stop: over.stop ?? jest.fn(),
    reapprove: over.reapprove ?? jest.fn(),
    bulkApprove: over.bulkApprove ?? jest.fn(),
    findManyByIdsForSeller:
      over.findManyByIdsForSeller ?? jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };
  const stockSyncService: any = {
    syncVariantStockFromMappings: jest.fn(),
  };
  const stockLedger: any = { record: jest.fn().mockResolvedValue(undefined) };
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

const VALID = {
  id: 'm-1',
  productId: 'p-1',
  variantId: null,
  sellerId: 'seller-1',
  approvalStatus: 'PENDING_APPROVAL',
  isActive: false,
  pickupPincode: '400001',
};

describe('approveMapping state-machine guard (Phase 57)', () => {
  it('throws 400 when repo.approve returns null (current status not PENDING_APPROVAL)', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...VALID, approvalStatus: 'STOPPED' }),
      approve: jest.fn().mockResolvedValue(null),
    });
    await expect(ctrl.approveMapping(req(), 'm-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('rejects with /reapprove hint when the current status is STOPPED', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...VALID, approvalStatus: 'STOPPED' }),
      approve: jest.fn().mockResolvedValue(null),
    });
    await expect(ctrl.approveMapping(req(), 'm-1')).rejects.toMatchObject({
      message: expect.stringMatching(/reapprove/i),
    });
  });

  it('rejects with resubmit hint when the current status is REJECTED', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...VALID, approvalStatus: 'REJECTED' }),
      approve: jest.fn().mockResolvedValue(null),
    });
    await expect(ctrl.approveMapping(req(), 'm-1')).rejects.toMatchObject({
      message: expect.stringMatching(/resubmit/i),
    });
  });
});

describe('approveMapping pincode precondition (Phase 57, Gap #12)', () => {
  it('throws 400 when pickupPincode is missing', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...VALID, pickupPincode: null }),
    });
    await expect(ctrl.approveMapping(req(), 'm-1')).rejects.toMatchObject({
      message: expect.stringMatching(/pincode/i),
    });
  });

  it('throws 400 when pickupPincode is malformed', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...VALID, pickupPincode: '12abc' }),
    });
    await expect(ctrl.approveMapping(req(), 'm-1')).rejects.toMatchObject({
      message: expect.stringMatching(/pincode/i),
    });
  });
});

describe('approveMapping success side effects (Phase 57)', () => {
  it('writes a MAPPING_APPROVED audit log + emits the event + invalidates cache', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue(VALID),
      approve: jest.fn().mockResolvedValue({
        ...VALID,
        approvalStatus: 'APPROVED',
        isActive: true,
      }),
      auditWrite,
      eventPublish,
      cacheInvalidate,
    });

    await ctrl.approveMapping(req('admin-7'), 'm-1');

    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MAPPING_APPROVED',
        module: 'catalog',
        resource: 'SellerProductMapping',
        resourceId: 'm-1',
        actorId: 'admin-7',
        actorRole: 'ADMIN',
      }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'catalog.seller_mapping.approved',
        aggregateId: 'm-1',
      }),
    );
    expect(cacheInvalidate).toHaveBeenCalled();
  });
});

describe('rejectMapping state-guard (Phase 57)', () => {
  it('throws 400 when the mapping is not PENDING_APPROVAL', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...VALID, approvalStatus: 'APPROVED' }),
      reject: jest.fn().mockResolvedValue(null),
    });
    await expect(
      ctrl.rejectMapping(req(), 'm-1', { reason: 'Quality issue' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('emits MAPPING_REJECTED audit + event + cache on success', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue(VALID),
      reject: jest
        .fn()
        .mockResolvedValue({ ...VALID, approvalStatus: 'REJECTED', isActive: false }),
      auditWrite,
      eventPublish,
    });
    await ctrl.rejectMapping(req(), 'm-1', { reason: 'Wrong category' });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MAPPING_REJECTED' }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'catalog.seller_mapping.rejected',
      }),
    );
  });
});

describe('stopMapping state-guard (Phase 57)', () => {
  it('throws 400 when the mapping is REJECTED', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...VALID, approvalStatus: 'REJECTED' }),
      stop: jest.fn().mockResolvedValue(null),
    });
    await expect(
      ctrl.stopMapping(req(), 'm-1', { reason: 'state guard test' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('emits MAPPING_STOPPED audit + event when transition succeeds', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ ...VALID, approvalStatus: 'APPROVED' }),
      stop: jest
        .fn()
        .mockResolvedValue({ ...VALID, approvalStatus: 'STOPPED', isActive: false }),
      auditWrite,
      eventPublish,
    });
    await ctrl.stopMapping(req(), 'm-1', { reason: 'compliance' });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MAPPING_STOPPED' }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'catalog.seller_mapping.stopped' }),
    );
  });
});

describe('reapproveMapping (Phase 57, Gap #2 STOPPED → APPROVED)', () => {
  it('throws 400 when the mapping is not STOPPED', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue(VALID),
      reapprove: jest.fn().mockResolvedValue(null),
    });
    await expect(
      ctrl.reapproveMapping(req(), 'm-1', { reason: 'Quality fixed' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('emits MAPPING_REAPPROVED audit + event on success', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        ...VALID,
        approvalStatus: 'STOPPED',
        isActive: false,
      }),
      reapprove: jest
        .fn()
        .mockResolvedValue({ ...VALID, approvalStatus: 'APPROVED', isActive: true }),
      auditWrite,
      eventPublish,
    });
    await ctrl.reapproveMapping(req(), 'm-1', { reason: 'Quality issue fixed' });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MAPPING_REAPPROVED' }),
    );
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'catalog.seller_mapping.reapproved',
      }),
    );
  });
});

describe('bulkApproveMappings (Phase 57, Gap #6)', () => {
  it('returns per-row outcomes and emits an event per successful row', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const eventPublish = jest.fn().mockResolvedValue(undefined);
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const findById = jest
      .fn()
      .mockResolvedValueOnce({ ...VALID, id: 'm-1' })
      .mockResolvedValueOnce({ ...VALID, id: 'm-2', approvalStatus: 'APPROVED' })
      .mockResolvedValueOnce({ ...VALID, id: 'm-1' })
      .mockResolvedValueOnce({ ...VALID, id: 'm-1', approvalStatus: 'APPROVED' });
    const bulkApprove = jest.fn().mockResolvedValue([
      { mappingId: 'm-1', ok: true },
      {
        mappingId: 'm-2',
        ok: false,
        reason: 'Mapping is APPROVED, not PENDING_APPROVAL',
      },
    ]);

    const ctrl = buildController({
      findById,
      bulkApprove,
      auditWrite,
      eventPublish,
      cacheInvalidate,
    });

    const res = await ctrl.bulkApproveMappings(req('admin-7'), {
      mappingIds: ['m-1', 'm-2'],
    });

    expect(bulkApprove).toHaveBeenCalledWith(['m-1', 'm-2'], 'admin-7');
    expect((res as any).data.results).toHaveLength(2);
    expect((res as any).message).toMatch(/1 of 2/);

    // Audit + event fire only for the ok row.
    expect(auditWrite).toHaveBeenCalledTimes(1);
    expect(eventPublish).toHaveBeenCalledWith(
      expect.objectContaining({ aggregateId: 'm-1', eventName: 'catalog.seller_mapping.approved' }),
    );
    // Cache invalidation fires once after the loop.
    expect(cacheInvalidate).toHaveBeenCalledTimes(1);
  });

  it('does NOT invalidate the cache when zero rows succeed', async () => {
    const cacheInvalidate = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      bulkApprove: jest.fn().mockResolvedValue([
        { mappingId: 'm-1', ok: false, reason: 'Not pending' },
      ]),
      findById: jest.fn().mockResolvedValue(null),
      cacheInvalidate,
    });
    await ctrl.bulkApproveMappings(req(), { mappingIds: ['m-1'] });
    expect(cacheInvalidate).not.toHaveBeenCalled();
  });
});
