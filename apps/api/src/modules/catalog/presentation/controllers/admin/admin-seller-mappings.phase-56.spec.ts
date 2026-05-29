/**
 * Phase 56 (2026-05-22) — pins the admin seller-mapping lifecycle
 * hardening:
 *
 *   - Per-method @Permissions (split from blanket catalog.approve)
 *   - New POST /:mappingId/reject with mandatory reason (audit Gap #1)
 *   - approve/reject/stop pass adminId so audit columns populate
 *     (audit Gap #4)
 *   - PATCH writes MANUAL_ADJUST ledger row on stockQty change with
 *     actorRole='ADMIN' (audit Gap #10)
 *   - PATCH no longer accepts reservedQty (audit Gap #14) — the
 *     DTO doesn't expose the field
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotFoundAppException } from '../../../../../core/exceptions';
import { AdminSellerMappingsController } from './admin-seller-mappings.controller';
import {
  AdminUpdateMappingDto,
  RejectMappingDto,
} from './dtos/admin-seller-mapping.dto';

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
  const dto = plainToInstance(cls, input);
  const errs = await validate(dto as object);
  return flattenErrors(errs);
}

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  setContext: jest.fn(),
} as any;

function buildController(overrides: {
  findById?: jest.Mock;
  approve?: jest.Mock;
  reject?: jest.Mock;
  stop?: jest.Mock;
  update?: jest.Mock;
  ledgerRecord?: jest.Mock;
  auditWrite?: jest.Mock;
  eventPublish?: jest.Mock;
  cacheInvalidate?: jest.Mock;
} = {}) {
  const productRepo: any = {};
  const sellerMappingRepo: any = {
    findById: overrides.findById ?? jest.fn(),
    approve: overrides.approve ?? jest.fn(),
    reject: overrides.reject ?? jest.fn(),
    stop: overrides.stop ?? jest.fn(),
    update: overrides.update ?? jest.fn(),
  };
  const stockSyncService: any = {
    syncVariantStockFromMappings: jest.fn(),
  };
  const stockLedger: any = {
    record: overrides.ledgerRecord ?? jest.fn().mockResolvedValue(undefined),
  };
  const audit: any = {
    writeAuditLog: overrides.auditWrite ?? jest.fn().mockResolvedValue(undefined),
  };
  const eventBus: any = {
    publish: overrides.eventPublish ?? jest.fn().mockResolvedValue(undefined),
  };
  const catalogCache: any = {
    invalidateProductLists:
      overrides.cacheInvalidate ?? jest.fn().mockResolvedValue(undefined),
  };
  // Phase 60 (2026-05-22) — RedisService added for the
  // per-product auto-repair lock.
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

function req(adminId = 'admin-7') {
  return { adminId } as any;
}

describe('AdminUpdateMappingDto (Phase 56)', () => {
  it('accepts a minimal valid payload', async () => {
    const msgs = await dtoMessages(AdminUpdateMappingDto, { stockQty: 5 });
    expect(msgs).toEqual([]);
  });

  it('rejects negative stockQty', async () => {
    const msgs = await dtoMessages(AdminUpdateMappingDto, { stockQty: -1 });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects fractional stockQty', async () => {
    const msgs = await dtoMessages(AdminUpdateMappingDto, { stockQty: 5.5 });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects malformed pickupPincode', async () => {
    const msgs = await dtoMessages(AdminUpdateMappingDto, {
      pickupPincode: '12345abc',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('pincode'))).toBe(true);
  });

  it('rejects dispatchSla > 30', async () => {
    const msgs = await dtoMessages(AdminUpdateMappingDto, { dispatchSla: 999 });
    expect(msgs.some((m) => m.includes('30'))).toBe(true);
  });

  it('rejects pickupAddress longer than 500 chars', async () => {
    const msgs = await dtoMessages(AdminUpdateMappingDto, {
      pickupAddress: 'a'.repeat(501),
    });
    expect(msgs.some((m) => m.includes('500'))).toBe(true);
  });

  it('rejects out-of-bounds latitude', async () => {
    const msgs = await dtoMessages(AdminUpdateMappingDto, { latitude: 999 });
    expect(msgs.length).toBeGreaterThan(0);
  });

  // Note: reservedQty (audit Gap #14) is enforced by the controller's
  // allowlist loop — even if a client sneaks the field past the
  // global ValidationPipe whitelist, the controller iterates a fixed
  // set of keys when building updateData and `reservedQty` isn't in
  // that set. See the updateMapping controller test below for the
  // behavioural assertion.
});

describe('RejectMappingDto (Phase 56)', () => {
  it('accepts a valid reason', async () => {
    const msgs = await dtoMessages(RejectMappingDto, { reason: 'Wrong category' });
    expect(msgs).toEqual([]);
  });

  it('rejects reason shorter than 3 chars', async () => {
    const msgs = await dtoMessages(RejectMappingDto, { reason: 'no' });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects reason longer than 500 chars', async () => {
    const msgs = await dtoMessages(RejectMappingDto, {
      reason: 'a'.repeat(501),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe('AdminSellerMappingsController.rejectMapping (Phase 56 — Gap #1)', () => {
  it('throws NotFound when the mapping does not exist', async () => {
    const ctrl = buildController({ findById: jest.fn().mockResolvedValue(null) });
    await expect(
      ctrl.rejectMapping(req(), 'm-ghost', { reason: 'Quality issue' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('calls repo.reject with adminId + reason', async () => {
    const reject = jest.fn().mockResolvedValue({ id: 'm-1', approvalStatus: 'REJECTED' });
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ id: 'm-1' }),
      reject,
    });

    await ctrl.rejectMapping(req('admin-7'), 'm-1', {
      reason: 'Category mismatch',
    });

    expect(reject).toHaveBeenCalledWith('m-1', 'admin-7', 'Category mismatch');
  });
});

describe('AdminSellerMappingsController.approveMapping / stopMapping (Phase 56)', () => {
  it('approve passes adminId to repo for audit attribution', async () => {
    const approve = jest.fn().mockResolvedValue({
      id: 'm-1',
      approvalStatus: 'APPROVED',
      isActive: true,
      productId: 'p-1',
      variantId: null,
      sellerId: 's-1',
    });
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        approvalStatus: 'PENDING_APPROVAL',
        isActive: false,
        productId: 'p-1',
        variantId: null,
        sellerId: 's-1',
        // Phase 57 precondition: approval requires a valid 6-digit pincode.
        pickupPincode: '400001',
      }),
      approve,
    });
    await ctrl.approveMapping(req('admin-7'), 'm-1');
    expect(approve).toHaveBeenCalledWith('m-1', 'admin-7');
  });

  it('stop passes adminId + optional reason to repo', async () => {
    const stop = jest.fn().mockResolvedValue({ id: 'm-1' });
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ id: 'm-1' }),
      stop,
    });
    await ctrl.stopMapping(req('admin-7'), 'm-1', { reason: 'Quality issue' });
    expect(stop).toHaveBeenCalledWith('m-1', 'admin-7', 'Quality issue');
  });
});

describe('AdminSellerMappingsController.updateMapping (Phase 56 — Gap #10 ledger)', () => {
  it('writes a MANUAL_ADJUST ledger row with actorRole=ADMIN when stockQty changes', async () => {
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        productId: 'p-1',
        variantId: null,
        stockQty: 5,
        reservedQty: 0,
      }),
      update: jest.fn().mockResolvedValue({ id: 'm-1', stockQty: 12 }),
      ledgerRecord,
    });

    await ctrl.updateMapping(req('admin-7'), 'm-1', { stockQty: 12 } as any);

    expect(ledgerRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MANUAL_ADJUST',
        beforeStockQty: 5,
        afterStockQty: 12,
        actorId: 'admin-7',
        actorRole: 'ADMIN',
        referenceType: 'ADMIN_OVERRIDE',
      }),
    );
  });

  it('does NOT write a ledger row when stockQty is unchanged', async () => {
    const ledgerRecord = jest.fn().mockResolvedValue(undefined);
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        productId: 'p-1',
        variantId: null,
        stockQty: 5,
        reservedQty: 0,
      }),
      update: jest.fn().mockResolvedValue({ id: 'm-1' }),
      ledgerRecord,
    });

    await ctrl.updateMapping(req('admin-7'), 'm-1', {
      lowStockThreshold: 3,
    } as any);

    expect(ledgerRecord).not.toHaveBeenCalled();
  });

  it('does NOT copy reservedQty into the update payload even if injected on the body (audit Gap #14)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'm-1' });
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        productId: 'p-1',
        variantId: null,
        stockQty: 5,
        reservedQty: 0,
      }),
      update,
    });

    // Cast lets us simulate a client smuggling reservedQty past validation.
    await ctrl.updateMapping(req('admin-7'), 'm-1', {
      stockQty: 10,
      reservedQty: 999,
    } as any);

    const writtenData = update.mock.calls[0][1];
    expect(writtenData.stockQty).toBe(10);
    expect(writtenData).not.toHaveProperty('reservedQty');
  });
});
