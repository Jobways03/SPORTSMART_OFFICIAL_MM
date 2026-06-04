// Phase 161 — UQC Master flow audit remediation coverage (sibling of the
// HSN master spec). Behavioural proof of each finding:
//   B2  create/update persist the acting admin (created_by / updated_by)
//   B3  every mutation writes an AuditPublicFacade row
//   #5  deactivating a referenced code needs force (HSN + product refs)
//   #7  every mutation writes a UqcMasterHistory row
//   #8  list() paginates (skip/take + total + hasMore)
//   #9  update is optimistic-concurrency guarded (409 on version drift)
//   #10 duplicate code create → clean 409 (not a 500)
//   #11 deactivation requires a reason
//   #12/#16 description is HTML-stripped + whitespace-collapsed
//   #13 lifecycle events are published
//   #14 bulkCreate validates + de-dupes + skipDuplicates
//   B1  isActiveUqcCode / assertActiveUqcCode authority primitive

import { Prisma } from '@prisma/client';
import { UqcMasterService, UQC_MASTER_EVENTS } from './uqc-master.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

function buildHarness(opts: any = {}) {
  let row: any = opts.row ?? null;
  const uqcMaster = {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id) return row && row.id === where.id ? { ...row } : null;
      if (where.code) return 'byCode' in opts ? opts.byCode : null;
      return null;
    }),
    count: jest.fn(async (_a: any) => opts.total ?? 0),
    findMany: jest.fn(async (_a: any) =>
      (opts.rows ?? (row ? [row] : [])).map((r: any) => ({ ...r })),
    ),
    create: jest.fn(async ({ data }: any) => {
      row = {
        id: 'uqc-new',
        version: 0,
        deactivationReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      return { ...row };
    }),
    createMany: jest.fn(async (args: any) => ({
      count: opts.insertCount ?? args?.data?.length ?? 0,
    })),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.version !== undefined && row && where.version !== row.version) {
        return { count: 0 };
      }
      if (row && row.id === where.id) {
        const applied: any = { ...data };
        if (applied.version && typeof applied.version === 'object') {
          applied.version = row.version + (applied.version.increment ?? 0);
        }
        row = { ...row, ...applied };
        return { count: 1 };
      }
      return { count: 0 };
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      if (!row || row.id !== where.id) throw new Error('not found');
      return { ...row };
    }),
  };
  const uqcMasterHistory = {
    create: jest.fn(async (_a: any) => ({})),
    findMany: jest.fn(async (_a: any) => opts.history ?? []),
  };
  const hsnMaster = { count: jest.fn(async (_a: any) => opts.hsnRefs ?? 0) };
  const product = { count: jest.fn(async (_a: any) => opts.productRefs ?? 0) };
  const txClient = { uqcMaster, uqcMasterHistory };
  const prisma: any = {
    uqcMaster,
    uqcMasterHistory,
    hsnMaster,
    product,
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(txClient) : Promise.all(arg),
    ),
  };
  const audit: any = { writeAuditLog: jest.fn(async () => undefined) };
  const eventBus: any = { publish: jest.fn(async (_e: any) => undefined) };
  const svc = new UqcMasterService(prisma, audit, eventBus);
  return { svc, prisma, uqcMaster, uqcMasterHistory, hsnMaster, product, audit, eventBus };
}

function baseRow(over: any = {}) {
  return {
    id: 'uqc-1',
    code: 'NOS',
    description: 'Numbers',
    isActive: true,
    version: 0,
    createdBy: 'admin-0',
    updatedBy: 'admin-0',
    deactivationReason: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    ...over,
  };
}

describe('UqcMasterService.create (Phase 161)', () => {
  it('B2/B3/#7/#13: persists actor + writes history + audit + event; uppercases code', async () => {
    const { svc, uqcMaster, uqcMasterHistory, audit, eventBus } = buildHarness();
    const res = await svc.create({ code: 'pcs', description: 'Pieces' }, 'admin-7');
    expect(res.code).toBe('PCS');
    expect(uqcMaster.create.mock.calls[0]![0].data.createdBy).toBe('admin-7');
    expect(uqcMaster.create.mock.calls[0]![0].data.updatedBy).toBe('admin-7');
    expect(uqcMasterHistory.create.mock.calls[0]![0].data.action).toBe('CREATE');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tax.uqc.created', module: 'tax-master', actorId: 'admin-7' }),
    );
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(UQC_MASTER_EVENTS.CREATED);
  });

  it('#10: duplicate code create → 409 (not 500)', async () => {
    const { svc, uqcMaster } = buildHarness();
    uqcMaster.create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' } as any),
    );
    await expect(
      svc.create({ code: 'NOS', description: 'Numbers' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejects a malformed code and an empty description', async () => {
    const { svc } = buildHarness();
    await expect(svc.create({ code: 'X', description: 'd' }, 'a')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    await expect(svc.create({ code: 'NOS', description: '   ' }, 'a')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('#12/#16: strips HTML + collapses whitespace in description', async () => {
    const { svc, uqcMaster } = buildHarness();
    await svc.create({ code: 'BOX', description: '  Box  <b>of</b>   items  ' }, 'admin-1');
    expect(uqcMaster.create.mock.calls[0]![0].data.description).toBe('Box of items');
  });
});

describe('UqcMasterService.update (Phase 161)', () => {
  it('B2/#9: persists updatedBy + bumps version', async () => {
    const { svc, uqcMaster } = buildHarness({ row: baseRow({ version: 3 }) });
    await svc.update('uqc-1', { description: 'Number of pieces' }, 'admin-9');
    const data = uqcMaster.updateMany.mock.calls[0]![0].data;
    expect(data.updatedBy).toBe('admin-9');
    expect(data.version).toEqual({ increment: 1 });
  });

  it('#9: rejects with 409 on version drift', async () => {
    const { svc } = buildHarness({ row: baseRow({ version: 5 }) });
    await expect(
      svc.update('uqc-1', { description: 'x', expectedVersion: 2 }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('#11: deactivation without a reason is refused', async () => {
    const { svc } = buildHarness({ row: baseRow({ isActive: true }) });
    await expect(
      svc.update('uqc-1', { isActive: false }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#5: deactivating a referenced code without force → 409 (HSN + product refs)', async () => {
    const { svc } = buildHarness({ row: baseRow({ isActive: true }), hsnRefs: 3, productRefs: 5000 });
    await expect(
      svc.update('uqc-1', { isActive: false, deactivationReason: 'replaced by PCS' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('#5/#11: deactivating with force + reason succeeds + logs DEACTIVATE', async () => {
    const { svc, uqcMaster, uqcMasterHistory, eventBus } = buildHarness({
      row: baseRow({ isActive: true }),
      productRefs: 5000,
    });
    const res = await svc.update(
      'uqc-1',
      { isActive: false, deactivationReason: 'replaced by PCS', force: true },
      'admin-1',
    );
    expect(res.isActive).toBe(false);
    expect(uqcMaster.updateMany.mock.calls[0]![0].data.deactivationReason).toBe('replaced by PCS');
    expect(uqcMasterHistory.create.mock.calls[0]![0].data.action).toBe('DEACTIVATE');
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(UQC_MASTER_EVENTS.DEACTIVATED);
  });

  it('reactivation clears the deactivation reason + logs REACTIVATE', async () => {
    const { svc, uqcMaster, uqcMasterHistory } = buildHarness({
      row: baseRow({ isActive: false, deactivationReason: 'old' }),
    });
    await svc.update('uqc-1', { isActive: true }, 'admin-1');
    expect(uqcMaster.updateMany.mock.calls[0]![0].data.deactivationReason).toBeNull();
    expect(uqcMasterHistory.create.mock.calls[0]![0].data.action).toBe('REACTIVATE');
  });
});

describe('UqcMasterService.list + bulk + authority (Phase 161)', () => {
  it('#8: paginates with skip/take + total + hasMore', async () => {
    const { svc, uqcMaster } = buildHarness({ row: baseRow(), total: 75 });
    const res = await svc.list({ page: 2, limit: 25 });
    expect(res.total).toBe(75);
    expect(res.hasMore).toBe(true);
    expect(uqcMaster.findMany.mock.calls[0]![0].skip).toBe(25);
    expect(uqcMaster.findMany.mock.calls[0]![0].take).toBe(25);
  });

  it('#14: bulkCreate validates, de-dupes within the batch, and skips duplicates', async () => {
    const { svc, uqcMaster } = buildHarness({ insertCount: 2 });
    const res = await svc.bulkCreate(
      [
        { code: 'pcs', description: 'Pieces' },
        { code: 'PCS', description: 'Pieces dup in batch' }, // collapses to one
        { code: 'box', description: 'Box' },
      ],
      'admin-1',
    );
    // batch de-duped PCS → 2 unique rows submitted to createMany
    expect(uqcMaster.createMany.mock.calls[0]![0].data).toHaveLength(2);
    expect(res.inserted).toBe(2);
  });

  it('#14: bulkCreate rejects a malformed code in the batch', async () => {
    const { svc } = buildHarness();
    await expect(
      svc.bulkCreate([{ code: 'X', description: 'bad' }], 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('B1: isActiveUqcCode true for an active row, false otherwise', async () => {
    const present = buildHarness({ byCode: { isActive: true } });
    expect(await present.svc.isActiveUqcCode('NOS')).toBe(true);

    const inactive = buildHarness({ byCode: { isActive: false } });
    expect(await inactive.svc.isActiveUqcCode('OLD')).toBe(false);

    const absent = buildHarness({ byCode: null });
    expect(await absent.svc.isActiveUqcCode('XYZ')).toBe(false);
    await expect(absent.svc.assertActiveUqcCode('XYZ')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });
});
