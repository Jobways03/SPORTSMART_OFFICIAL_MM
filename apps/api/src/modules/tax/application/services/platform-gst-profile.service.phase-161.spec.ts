// Phase 161 — Platform GST Profile flow audit remediation coverage (third of
// the tax-master trio). Behavioural proof of each finding:
//   B4  every mutation writes an AuditPublicFacade row
//   B5  create/update/setDefault persist the acting admin
//   #7  PAN is regex-validated + MASKED in API responses (panLast4 only)
//   #10 deactivating the current DEFAULT is rejected
//   #11 setDefault / deactivate require a reason
//   #12 update is OCC-guarded (409 on drift); history rows written
//   #15 registeredAddressJson is structurally validated
//   #16 lifecycle events are published
//   #17 update() can promote to default (with reason)
//   §10 duplicate / partial-unique P2002 → 409
//   B1  getProfileForState — state-specific else default

jest.mock('../../domain/gstin-validator', () => ({
  validateGstin: jest.fn(() => ({ isValid: true, stateCode: '29', errors: [] })),
}));

import { Prisma } from '@prisma/client';
import {
  PlatformGstProfileService,
  PLATFORM_GST_EVENTS,
} from './platform-gst-profile.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import { validateGstin } from '../../domain/gstin-validator';

const mockValidateGstin = validateGstin as jest.MockedFunction<typeof validateGstin>;

function buildHarness(opts: any = {}) {
  let row: any = opts.row ?? null;
  const platformGstProfile = {
    findUnique: jest.fn(async ({ where }: any) =>
      row && row.id === where.id ? { ...row } : null,
    ),
    findFirst: jest.fn(async ({ where }: any) => {
      if (where?.gstStateCode) return opts.stateRow ?? null;
      if (where?.isDefault) return opts.defaultRow ?? (row && row.isDefault ? { ...row } : null);
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async () => (row ? [{ ...row }] : [])),
    create: jest.fn(async ({ data }: any) => {
      row = {
        id: 'pgp-new',
        version: 0,
        panVerified: false,
        deactivationReason: null,
        setDefaultReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.version !== undefined && row && where.version !== row.version) {
        return { count: 0 };
      }
      if (where.id && row && row.id === where.id) {
        const applied: any = { ...data };
        if (applied.version && typeof applied.version === 'object') {
          applied.version = row.version + (applied.version.increment ?? 0);
        }
        row = { ...row, ...applied };
        return { count: 1 };
      }
      return { count: 0 }; // clear-others (id:{not}) — no-op in single-row harness
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const applied: any = { ...data };
      if (applied.version && typeof applied.version === 'object') {
        applied.version = (row?.version ?? 0) + (applied.version.increment ?? 0);
      }
      row = { ...row, ...applied, id: where.id };
      return { ...row };
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      if (!row || row.id !== where.id) throw new Error('not found');
      return { ...row };
    }),
  };
  const platformGstProfileHistory = {
    create: jest.fn(async (_a: any) => ({})),
    findMany: jest.fn(async (_a: any) => opts.history ?? []),
  };
  const txClient = { platformGstProfile, platformGstProfileHistory };
  const prisma: any = {
    platformGstProfile,
    platformGstProfileHistory,
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(txClient) : Promise.all(arg),
    ),
  };
  const audit: any = { writeAuditLog: jest.fn(async () => undefined) };
  const eventBus: any = { publish: jest.fn(async (_e: any) => undefined) };
  const svc = new PlatformGstProfileService(prisma, audit, eventBus);
  return { svc, prisma, platformGstProfile, platformGstProfileHistory, audit, eventBus };
}

function baseRow(over: any = {}) {
  return {
    id: 'pgp-1',
    legalBusinessName: 'Sportsmart Pvt Ltd',
    gstin: '29ABCDE1234F1Z5',
    registeredAddressJson: { city: 'Bengaluru', pincode: '560001' },
    gstStateCode: '29',
    registrationType: 'REGULAR',
    panNumber: 'ABCDE1234F',
    panLast4: '234F',
    panVerified: false,
    isDefault: true,
    isActive: true,
    version: 0,
    createdBy: 'admin-0',
    updatedBy: 'admin-0',
    deactivationReason: null,
    setDefaultReason: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    ...over,
  };
}

beforeEach(() => {
  mockValidateGstin.mockReturnValue({ isValid: true, stateCode: '29', errors: [] } as any);
});

describe('PlatformGstProfileService.create (Phase 161)', () => {
  const input = {
    legalBusinessName: 'Sportsmart Pvt Ltd',
    gstin: '29ABCDE1234F1Z5',
    registeredAddressJson: { city: 'Bengaluru', pincode: '560001' },
    panNumber: 'ABCDE1234F',
  };

  it('B4/B5/#12/#16: persists actor + history + audit + event', async () => {
    const { svc, platformGstProfile, platformGstProfileHistory, audit, eventBus } = buildHarness();
    await svc.create(input, 'admin-7');
    expect(platformGstProfile.create.mock.calls[0]![0].data.createdBy).toBe('admin-7');
    expect(platformGstProfileHistory.create.mock.calls[0]![0].data.action).toBe('CREATE');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: PLATFORM_GST_EVENTS.CREATED, module: 'tax-master', actorId: 'admin-7' }),
    );
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(PLATFORM_GST_EVENTS.CREATED);
  });

  it('#7: stores full PAN internally but MASKS it in the API response', async () => {
    const { svc, platformGstProfile } = buildHarness();
    const item = await svc.create(input, 'admin-1');
    // Stored: full PAN persisted (for internal consumers like Form 26Q).
    expect(platformGstProfile.create.mock.calls[0]![0].data.panNumber).toBe('ABCDE1234F');
    // Returned: only the last 4; no full PAN field on the API item.
    expect(item.panLast4).toBe('234F');
    expect((item as any).panNumber).toBeUndefined();
  });

  it('#7: rejects a malformed PAN', async () => {
    const { svc } = buildHarness();
    await expect(
      svc.create({ ...input, panNumber: 'BADPAN' }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects an invalid GSTIN', async () => {
    mockValidateGstin.mockReturnValue({ isValid: false, stateCode: null, errors: ['bad checksum'] } as any);
    const { svc } = buildHarness();
    await expect(svc.create(input, 'admin-1')).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#15: rejects a non-object address and a bad pincode', async () => {
    const { svc } = buildHarness();
    await expect(
      svc.create({ ...input, registeredAddressJson: 'a string' as any }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    await expect(
      svc.create({ ...input, registeredAddressJson: { pincode: '12' } }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('§10: duplicate / partial-unique P2002 → 409', async () => {
    const { svc, platformGstProfile } = buildHarness();
    platformGstProfile.create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' } as any),
    );
    await expect(svc.create(input, 'admin-1')).rejects.toBeInstanceOf(ConflictAppException);
  });
});

describe('PlatformGstProfileService.update (Phase 161)', () => {
  it('B5/#12: persists updatedBy + bumps version', async () => {
    const { svc, platformGstProfile } = buildHarness({ row: baseRow({ version: 4, isDefault: false }) });
    await svc.update('pgp-1', { legalBusinessName: 'New Name' }, 'admin-9');
    const data = platformGstProfile.updateMany.mock.calls.find((c: any) => c[0].where.version !== undefined)![0].data;
    expect(data.updatedBy).toBe('admin-9');
    expect(data.version).toEqual({ increment: 1 });
  });

  it('#12: rejects with 409 on version drift', async () => {
    const { svc } = buildHarness({ row: baseRow({ version: 5, isDefault: false }) });
    await expect(
      svc.update('pgp-1', { legalBusinessName: 'x', expectedVersion: 2 }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('#10: deactivating the CURRENT default is rejected', async () => {
    const { svc } = buildHarness({ row: baseRow({ isDefault: true, isActive: true }) });
    await expect(
      svc.update('pgp-1', { isActive: false, deactivationReason: 'closing this registration' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('#11: deactivating a NON-default without a reason is refused', async () => {
    const { svc } = buildHarness({ row: baseRow({ isDefault: false, isActive: true }) });
    await expect(
      svc.update('pgp-1', { isActive: false }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('#10/#11: deactivating a NON-default with a reason succeeds + logs DEACTIVATE', async () => {
    const { svc, platformGstProfile, platformGstProfileHistory } = buildHarness({
      row: baseRow({ isDefault: false, isActive: true }),
    });
    const res = await svc.update(
      'pgp-1',
      { isActive: false, deactivationReason: 'GST registration surrendered in this state' },
      'admin-1',
    );
    expect(res.isActive).toBe(false);
    expect(platformGstProfileHistory.create.mock.calls[0]![0].data.action).toBe('DEACTIVATE');
    void platformGstProfile;
  });

  it('#17: promoting to default in update requires a reason and logs SET_DEFAULT', async () => {
    const noReason = buildHarness({ row: baseRow({ isDefault: false }) });
    await expect(
      noReason.svc.update('pgp-1', { isDefault: true }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    const ok = buildHarness({ row: baseRow({ isDefault: false }) });
    await ok.svc.update('pgp-1', { isDefault: true, setDefaultReason: 'HQ moved to this state' }, 'admin-1');
    expect(ok.platformGstProfileHistory.create.mock.calls[0]![0].data.action).toBe('SET_DEFAULT');
    expect(ok.eventBus.publish.mock.calls[0]![0].eventName).toBe(PLATFORM_GST_EVENTS.DEFAULT_CHANGED);
  });
});

describe('PlatformGstProfileService.setDefault (Phase 161)', () => {
  it('#11: requires a reason', async () => {
    const { svc } = buildHarness({ row: baseRow({ isDefault: false }) });
    await expect(svc.setDefault('pgp-1', 'no', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('#11/B4/#16: persists reason + history SET_DEFAULT + audit + event', async () => {
    const { svc, platformGstProfile, platformGstProfileHistory, audit, eventBus } = buildHarness({
      row: baseRow({ isDefault: false, isActive: true }),
    });
    await svc.setDefault('pgp-1', 'Switching primary registration to MH', 'admin-2');
    expect(platformGstProfile.update.mock.calls[0]![0].data.setDefaultReason).toBe(
      'Switching primary registration to MH',
    );
    expect(platformGstProfileHistory.create.mock.calls[0]![0].data.action).toBe('SET_DEFAULT');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: PLATFORM_GST_EVENTS.DEFAULT_CHANGED, actorId: 'admin-2' }),
    );
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(PLATFORM_GST_EVENTS.DEFAULT_CHANGED);
  });

  it('rejects setting an inactive profile as default', async () => {
    const { svc } = buildHarness({ row: baseRow({ isActive: false, isDefault: false }) });
    await expect(
      svc.setDefault('pgp-1', 'trying to default an inactive one', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('PlatformGstProfileService.getProfileForState (Phase 161 B1)', () => {
  it('returns the state-specific active profile when one exists', async () => {
    const { svc } = buildHarness({
      stateRow: { ...baseRow({ id: 'pgp-mh', gstStateCode: '27', isDefault: false }) },
    });
    const res = await svc.getProfileForState('27');
    expect(res?.gstStateCode).toBe('27');
  });

  it('falls back to the default when no state-specific profile exists', async () => {
    const { svc } = buildHarness({
      stateRow: null,
      defaultRow: baseRow({ gstStateCode: '29', isDefault: true }),
    });
    const res = await svc.getProfileForState('99');
    expect(res?.gstStateCode).toBe('29');
    expect(res?.isDefault).toBe(true);
  });
});
