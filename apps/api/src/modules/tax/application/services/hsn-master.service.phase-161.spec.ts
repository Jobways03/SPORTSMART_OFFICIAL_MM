// Phase 161 — HSN Master flow audit remediation coverage.
//
// Behavioural proof (runtime, not just "configured") of each finding:
//   B2  create/update persist the acting admin (created_by / updated_by)
//   B3  every mutation writes an AuditPublicFacade row
//   #5  deactivating a code referenced by live products needs force
//   #7  defaultUqcCode is validated against the UQC master
//   #8  every mutation writes an HsnMasterHistory row (CREATE/UPDATE/…)
//   #9  list() paginates (skip/take + total + hasMore)
//   #11 deactivation requires a reason
//   #12 update is optimistic-concurrency guarded (409 on version drift)
//   #14 free-text fields are HTML-stripped
//   #15 lifecycle events are published
//   #16 hsnCode search anchors with startsWith
//   §9  duplicate (hsnCode, effectiveFrom) surfaces a clean 409, not a 500
//   B1  isActiveHsnCode / assertActiveHsnCode authority primitive
//   #10 closeWindow is the only path that mutates effectiveTo

import { Prisma } from '@prisma/client';
import { HsnMasterService, HSN_MASTER_EVENTS } from './hsn-master.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

function buildHarness(opts: any = {}) {
  let row: any = opts.row ?? null;
  const hsnMaster = {
    findUnique: jest.fn(async ({ where }: any) =>
      row && row.id === where.id ? { ...row } : null,
    ),
    findFirst: jest.fn(async () =>
      'activeHsn' in opts ? opts.activeHsn : row && row.isActive ? { ...row } : null,
    ),
    count: jest.fn(async (_args: any) => opts.total ?? 0),
    findMany: jest.fn(async (_args: any) =>
      (opts.rows ?? (row ? [row] : [])).map((r: any) => ({ ...r })),
    ),
    create: jest.fn(async ({ data }: any) => {
      row = {
        id: 'hsn-new',
        version: 0,
        effectiveTo: null,
        deactivationReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      // create's "close prior open window" call targets by hsnCode — no-op here.
      if (where.id === undefined) return { count: 0 };
      // OCC: reject on version drift.
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
  const hsnMasterHistory = {
    create: jest.fn(async (_args: any) => ({})),
    findMany: jest.fn(async (_args: any) => opts.history ?? []),
  };
  const uqcMaster = {
    findUnique: jest.fn(async () => (('uqc' in opts) ? opts.uqc : null)),
  };
  const product = { count: jest.fn(async () => opts.productRefs ?? 0) };
  const txClient = { hsnMaster, hsnMasterHistory, uqcMaster, product };
  const prisma: any = {
    hsnMaster,
    hsnMasterHistory,
    uqcMaster,
    product,
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(txClient) : Promise.all(arg),
    ),
  };
  const audit: any = { writeAuditLog: jest.fn(async () => undefined) };
  const eventBus: any = { publish: jest.fn(async (_e: any) => undefined) };
  const svc = new HsnMasterService(prisma, audit, eventBus);
  return { svc, prisma, hsnMaster, hsnMasterHistory, uqcMaster, product, audit, eventBus };
}

const FROM = new Date('2026-04-01T00:00:00.000Z');

function baseRow(over: any = {}) {
  return {
    id: 'hsn-1',
    hsnCode: '61091000',
    description: 'T-shirts',
    defaultGstRateBps: 1200,
    supplyTaxability: 'TAXABLE',
    defaultUqcCode: 'PCS',
    categoryHint: 'apparel',
    isActive: true,
    effectiveFrom: FROM,
    effectiveTo: null,
    version: 0,
    createdBy: 'admin-0',
    updatedBy: 'admin-0',
    deactivationReason: null,
    createdAt: FROM,
    updatedAt: FROM,
    ...over,
  };
}

describe('HsnMasterService.create (Phase 161)', () => {
  it('B2/B3/#8/#15: persists actor, writes history + audit + event', async () => {
    const { svc, hsnMaster, hsnMasterHistory, audit, eventBus } = buildHarness({
      uqc: { isActive: true },
    });
    await svc.create(
      { hsnCode: '61091000', description: 'T-shirts', defaultGstRateBps: 1200, defaultUqcCode: 'PCS' },
      'admin-7',
    );
    expect(hsnMaster.create.mock.calls[0]![0].data.createdBy).toBe('admin-7');
    expect(hsnMaster.create.mock.calls[0]![0].data.updatedBy).toBe('admin-7');
    expect(hsnMasterHistory.create.mock.calls[0]![0].data.action).toBe('CREATE');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tax.hsn.created', module: 'tax-master', actorId: 'admin-7' }),
    );
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(HSN_MASTER_EVENTS.CREATED);
  });

  it('#7: rejects a defaultUqcCode not in the UQC master', async () => {
    const { svc } = buildHarness({ uqc: null }); // not found
    await expect(
      svc.create(
        { hsnCode: '61091000', description: 'X', defaultGstRateBps: 1200, defaultUqcCode: 'BADUQC' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#7: rejects an inactive UQC code', async () => {
    const { svc } = buildHarness({ uqc: { isActive: false } });
    await expect(
      svc.create(
        { hsnCode: '61091000', description: 'X', defaultGstRateBps: 1200, defaultUqcCode: 'OLD' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#14: strips HTML from description before persisting', async () => {
    const { svc, hsnMaster } = buildHarness({ uqc: { isActive: true } });
    await svc.create(
      { hsnCode: '61091000', description: 'Shirt <script>alert(1)</script> cotton', defaultGstRateBps: 1200 },
      'admin-1',
    );
    expect(hsnMaster.create.mock.calls[0]![0].data.description).toBe('Shirt alert(1) cotton');
  });

  it('§9: maps a duplicate (hsnCode, effectiveFrom) P2002 to a 409', async () => {
    const { svc, hsnMaster } = buildHarness({ uqc: { isActive: true } });
    hsnMaster.create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' } as any),
    );
    await expect(
      svc.create({ hsnCode: '61091000', description: 'X', defaultGstRateBps: 1200 }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejects an out-of-range rate and a malformed code', async () => {
    const { svc } = buildHarness();
    await expect(
      svc.create({ hsnCode: '61091000', description: 'X', defaultGstRateBps: 99999 }, 'a'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    await expect(
      svc.create({ hsnCode: 'abc', description: 'X', defaultGstRateBps: 1200 }, 'a'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('HsnMasterService.update (Phase 161)', () => {
  it('B2/#12: persists updatedBy and bumps version', async () => {
    const { svc, hsnMaster } = buildHarness({ row: baseRow({ version: 4 }) });
    await svc.update('hsn-1', { description: 'Updated desc' }, 'admin-9');
    const data = hsnMaster.updateMany.mock.calls[0]![0].data;
    expect(data.updatedBy).toBe('admin-9');
    expect(data.version).toEqual({ increment: 1 });
  });

  it('#12: rejects with 409 when expectedVersion has drifted', async () => {
    const { svc } = buildHarness({ row: baseRow({ version: 5 }) });
    await expect(
      svc.update('hsn-1', { description: 'x', expectedVersion: 2 }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('#11: deactivation without a reason is refused', async () => {
    const { svc } = buildHarness({ row: baseRow({ isActive: true }) });
    await expect(
      svc.update('hsn-1', { isActive: false }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#5: deactivating a referenced code without force is refused (409)', async () => {
    const { svc } = buildHarness({ row: baseRow({ isActive: true }), productRefs: 5000 });
    await expect(
      svc.update('hsn-1', { isActive: false, deactivationReason: 'CBIC merged the heading' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('#5/#11: deactivating with force + reason succeeds and records the reason', async () => {
    const { svc, hsnMaster, hsnMasterHistory, eventBus } = buildHarness({
      row: baseRow({ isActive: true }),
      productRefs: 5000,
    });
    const res = await svc.update(
      'hsn-1',
      { isActive: false, deactivationReason: 'CBIC merged the heading', force: true },
      'admin-1',
    );
    expect(res.isActive).toBe(false);
    expect(hsnMaster.updateMany.mock.calls[0]![0].data.deactivationReason).toBe('CBIC merged the heading');
    expect(hsnMasterHistory.create.mock.calls[0]![0].data.action).toBe('DEACTIVATE');
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(HSN_MASTER_EVENTS.DEACTIVATED);
  });

  it('reactivation clears the deactivation reason + logs REACTIVATE', async () => {
    const { svc, hsnMaster, hsnMasterHistory } = buildHarness({
      row: baseRow({ isActive: false, deactivationReason: 'old' }),
    });
    await svc.update('hsn-1', { isActive: true }, 'admin-1');
    expect(hsnMaster.updateMany.mock.calls[0]![0].data.deactivationReason).toBeNull();
    expect(hsnMasterHistory.create.mock.calls[0]![0].data.action).toBe('REACTIVATE');
  });

  it('#8/B3: a plain field edit writes history (UPDATE) + audit', async () => {
    const { svc, hsnMasterHistory, audit } = buildHarness({ row: baseRow(), uqc: { isActive: true } });
    await svc.update('hsn-1', { categoryHint: 'footwear' }, 'admin-1');
    expect(hsnMasterHistory.create.mock.calls[0]![0].data.action).toBe('UPDATE');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tax.hsn.updated', resource: 'hsn_master' }),
    );
  });
});

describe('HsnMasterService.list (Phase 161)', () => {
  it('#9: paginates with skip/take + total + hasMore', async () => {
    const { svc, hsnMaster } = buildHarness({ row: baseRow(), total: 120 });
    const res = await svc.list({ page: 2, limit: 50 });
    expect(res.total).toBe(120);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(50);
    expect(res.hasMore).toBe(true);
    const findArgs = hsnMaster.findMany.mock.calls[0]![0];
    expect(findArgs.skip).toBe(50);
    expect(findArgs.take).toBe(50);
  });

  it('#9: caps limit at 200', async () => {
    const { svc, hsnMaster } = buildHarness({ row: baseRow(), total: 1 });
    await svc.list({ limit: 9999 });
    expect(hsnMaster.findMany.mock.calls[0]![0].take).toBe(200);
  });

  it('#16: hsnCode search anchors with startsWith', async () => {
    const { svc, hsnMaster } = buildHarness({ row: baseRow(), total: 1 });
    await svc.list({ search: '85' });
    const or = hsnMaster.findMany.mock.calls[0]![0].where.OR;
    expect(or[0]).toEqual({ hsnCode: { startsWith: '85' } });
  });
});

describe('HsnMasterService authority + window (Phase 161)', () => {
  it('B1: isActiveHsnCode true for an active in-window row, false otherwise', async () => {
    const present = buildHarness({ activeHsn: { id: 'x' } });
    expect(await present.svc.isActiveHsnCode('61091000')).toBe(true);

    const absent = buildHarness({ activeHsn: null });
    expect(await absent.svc.isActiveHsnCode('99999999')).toBe(false);
    await expect(absent.svc.assertActiveHsnCode('99999999')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('#10: closeWindow sets effectiveTo + logs CLOSE_WINDOW; rejects before-from', async () => {
    const { svc, hsnMaster, hsnMasterHistory, eventBus } = buildHarness({ row: baseRow() });
    await svc.closeWindow(
      'hsn-1',
      { effectiveTo: '2026-12-31T00:00:00.000Z', reason: 'superseded' },
      'admin-1',
    );
    expect(hsnMaster.updateMany.mock.calls[0]![0].data.effectiveTo).toBeInstanceOf(Date);
    expect(hsnMasterHistory.create.mock.calls[0]![0].data.action).toBe('CLOSE_WINDOW');
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(HSN_MASTER_EVENTS.WINDOW_CLOSED);

    const { svc: svc2 } = buildHarness({ row: baseRow() });
    await expect(
      svc2.closeWindow('hsn-1', { effectiveTo: '2026-01-01T00:00:00.000Z' }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException); // before effectiveFrom (2026-04-01)
  });
});
