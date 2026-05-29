import 'reflect-metadata';
import { FranchisePincodeMappingService } from '../../src/modules/franchise/application/services/franchise-pincode-mapping.service';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

/**
 * Phase 159m — FranchisePincodeMappingService coverage.
 * status guard, PostOffice validation, OCC, create/update/deactivate,
 * bulk all-or-nothing, soft-remove, history + audit + event.
 */
function build(
  opts: {
    franchiseStatus?: string;
    franchiseExists?: boolean;
    existing?: { id: string; version: number; priority: number; isActive: boolean } | null;
    knownPincodes?: string[]; // PostOffice catalogue
    casCount?: number;
  } = {},
) {
  const eventCreate = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: opts.casCount ?? 1 });
  const create = jest.fn().mockResolvedValue({ id: 'new-1' });
  const update = jest.fn().mockResolvedValue({});
  const upsert = jest.fn().mockResolvedValue({});
  const finalRow = { id: opts.existing?.id ?? 'new-1', pincode: '560001' };
  const mappingFindUnique = jest
    .fn()
    .mockResolvedValueOnce(opts.existing ?? null)
    .mockResolvedValue(finalRow);
  const known = opts.knownPincodes ?? ['560001', '560002', '560034'];

  const prisma: any = {
    franchisePartner: {
      findUnique: jest.fn().mockResolvedValue(
        opts.franchiseExists === false
          ? null
          : { id: 'fr-1', status: opts.franchiseStatus ?? 'ACTIVE' },
      ),
    },
    franchisePincodeMapping: {
      findUnique: mappingFindUnique,
      findMany: jest.fn().mockResolvedValue([]),
      create,
      update,
      updateMany,
      upsert,
    },
    franchisePincodeMappingEvent: { create: eventCreate },
    postOffice: {
      findFirst: jest
        .fn()
        .mockImplementation(async (a: any) =>
          known.includes(a.where.pincode) ? { pincode: a.where.pincode } : null,
        ),
      findMany: jest
        .fn()
        .mockImplementation(async (a: any) =>
          (a.where.pincode.in as string[])
            .filter((p) => known.includes(p))
            .map((pincode) => ({ pincode })),
        ),
    },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
  const svc = new FranchisePincodeMappingService(prisma, audit, eventBus, logger);
  return { svc, prisma, eventCreate, updateMany, create, update, upsert, audit, eventBus };
}

const ctx = { adminId: 'admin-1', ipAddress: '127.0.0.1', userAgent: 'jest' };

describe('FranchisePincodeMappingService.assign', () => {
  it('blocks a non-ACTIVE/APPROVED franchise (status guard)', async () => {
    const { svc } = build({ franchiseStatus: 'DEACTIVATED' });
    await expect(
      svc.assign('fr-1', { pincode: '560001' }, ctx),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('rejects a pincode not in the PostOffice catalogue', async () => {
    const { svc } = build({ knownPincodes: ['560002'] });
    await expect(
      svc.assign('fr-1', { pincode: '560001' }, ctx),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects a stale expectedVersion (OCC)', async () => {
    const { svc } = build({
      existing: { id: 'm-1', version: 5, priority: 100, isActive: true },
    });
    await expect(
      svc.assign('fr-1', { pincode: '560001', expectedVersion: 3 }, ctx),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('create path: creates row + ASSIGNED history event', async () => {
    const { svc, create, eventCreate } = build({ existing: null });
    await svc.assign('fr-1', { pincode: '560001', priority: 200 }, ctx);
    expect(create).toHaveBeenCalled();
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ASSIGNED' }) }),
    );
  });

  it('throws Conflict when the version-CAS matches 0 rows', async () => {
    const { svc } = build({
      existing: { id: 'm-1', version: 2, priority: 100, isActive: true },
      casCount: 0,
    });
    await expect(
      svc.assign('fr-1', { pincode: '560001', expectedVersion: 2 }, ctx),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('deactivate (isActive=false) on an active row → DEACTIVATED event', async () => {
    const { svc, eventCreate } = build({
      existing: { id: 'm-1', version: 1, priority: 100, isActive: true },
    });
    await svc.assign('fr-1', { pincode: '560001', isActive: false }, ctx);
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DEACTIVATED' }) }),
    );
  });
});

describe('FranchisePincodeMappingService.bulkAssign', () => {
  it('rejects the whole batch if any pincode is unknown (all-or-nothing)', async () => {
    const { svc, upsert } = build({ knownPincodes: ['560001'] });
    await expect(
      svc.bulkAssign('fr-1', { pincodes: ['560001', '999999'] }, ctx),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts every pincode + one BULK_ASSIGNED event', async () => {
    const { svc, upsert, eventCreate } = build({ knownPincodes: ['560001', '560002'] });
    const res = await svc.bulkAssign('fr-1', { pincodes: ['560001', '560002'], priority: 50 }, ctx);
    expect(res.assigned).toBe(2);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'BULK_ASSIGNED' }) }),
    );
  });
});

describe('FranchisePincodeMappingService.remove', () => {
  it('404s when the mapping belongs to another franchise', async () => {
    const { svc, prisma } = build();
    prisma.franchisePincodeMapping.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'm-1', franchiseId: 'OTHER', pincode: '560001', priority: 100, isActive: true });
    await expect(svc.remove('fr-1', 'm-1', ctx)).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('soft-removes + writes REMOVED event', async () => {
    const { svc, prisma, update, eventCreate } = build();
    prisma.franchisePincodeMapping.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'm-1', franchiseId: 'fr-1', pincode: '560001', priority: 100, isActive: true });
    await svc.remove('fr-1', 'm-1', ctx);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REMOVED' }) }),
    );
  });
});
