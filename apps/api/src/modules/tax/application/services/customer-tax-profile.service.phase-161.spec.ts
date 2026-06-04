// Phase 161 — Customer Tax Profile flow audit remediation coverage.
// Behavioural proof of each finding:
//   B1  every CRUD mutation writes an AuditPublicFacade row
//   #4  create kicks off GSTN auto-verify (fire-and-forget)
//   #8  every mutation writes a CustomerTaxProfileHistory row (incl. DELETE)
//   #9  listSharedGstins aggregates GSTINs across accounts
//   #11 lifecycle events published
//   #12 update({isDefault:false}) throws (no silent no-op)
//   #17 concurrent duplicate create → 409 (P2002 mapped)
// (#5 legalNameMismatch + #15 fuzzy match were delivered with audit #159.)

jest.mock('../../domain/gstin-validator', () => ({
  validateGstin: jest.fn(() => ({
    isValid: true,
    normalized: '29ABCDE1234F1Z5',
    stateCode: '29',
    errors: [],
  })),
}));

import { Prisma } from '@prisma/client';
import {
  CustomerTaxProfileService,
  CUSTOMER_TAX_PROFILE_EVENTS,
} from './customer-tax-profile.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

function buildHarness(opts: any = {}) {
  let row: any = opts.row ?? null;
  const customerTaxProfile = {
    findMany: jest.fn(async () => (row ? [row] : [])),
    findUnique: jest.fn(async ({ where }: any) =>
      row && row.id === where.id ? { ...row } : null,
    ),
    findFirst: jest.fn(async () => opts.duplicate ?? null),
    count: jest.fn(async ({ where }: any) =>
      where?.NOT ? (opts.otherCount ?? 0) : (opts.existingCount ?? 0),
    ),
    create: jest.fn(async ({ data }: any) => {
      if (opts.createThrowsP2002) {
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' } as any);
      }
      row = { id: 'ctp-new', isVerified: false, ...data };
      return { ...row };
    }),
    update: jest.fn(async ({ data }: any) => {
      row = { ...row, ...data };
      return { ...row };
    }),
    updateMany: jest.fn(async () => ({ count: 1 })),
    delete: jest.fn(async () => ({})),
    groupBy: jest.fn(async () => opts.grouped ?? []),
  };
  const customerTaxProfileHistory = { create: jest.fn(async (_a: any) => ({})) };
  // Phase 200 (#1) — create/update now cross-validate the billing state against
  // the GSTIN's state code via india_states. stateCode 29 = Karnataka.
  const indiaState = {
    findMany: jest.fn(async () => [{ gstStateCode: '29', stateName: 'Karnataka' }]),
  };
  const txClient = { customerTaxProfile, customerTaxProfileHistory };
  const prisma: any = {
    customerTaxProfile,
    customerTaxProfileHistory,
    indiaState,
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(txClient) : Promise.all(arg),
    ),
  };
  const audit: any = { writeAuditLog: jest.fn(async () => undefined) };
  const eventBus: any = { publish: jest.fn(async (_e: any) => undefined) };
  const gstnVerification: any = { verifyCustomerTaxProfile: jest.fn(async () => ({ verified: true })) };
  const svc = new CustomerTaxProfileService(prisma, audit, eventBus, gstnVerification);
  return { svc, prisma, customerTaxProfile, customerTaxProfileHistory, audit, eventBus, gstnVerification };
}

function row(over: any = {}) {
  return {
    id: 'ctp-1',
    customerId: 'cust-1',
    gstin: '29ABCDE1234F1Z5',
    legalName: 'Acme Pvt Ltd',
    billingAddressJson: { city: 'Bengaluru', pincode: '560001' },
    stateCode: '29',
    isDefault: true,
    isVerified: false,
    legalNameMismatch: false,
    ...over,
  };
}

const CREATE_INPUT = {
  gstin: '29ABCDE1234F1Z5',
  legalName: 'Acme Pvt Ltd',
  // Phase 200 (#1) — state must match the GSTIN's state code (29 = Karnataka).
  billingAddress: { line1: '1 St', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', stateCode: '29' } as any,
};

describe('CustomerTaxProfileService.create (Phase 161)', () => {
  it('B1/#8/#11/#4: audit + history(CREATE) + event + auto-verify', async () => {
    const { svc, customerTaxProfileHistory, audit, eventBus, gstnVerification } = buildHarness({
      existingCount: 0,
    });
    await svc.create('cust-1', CREATE_INPUT, { ipAddress: '1.2.3.4' });
    expect(customerTaxProfileHistory.create.mock.calls[0]![0].data.action).toBe('CREATE');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: CUSTOMER_TAX_PROFILE_EVENTS.CREATED, actorId: 'cust-1' }),
    );
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(CUSTOMER_TAX_PROFILE_EVENTS.CREATED);
    // #4 — auto-verify kicked off
    expect(gstnVerification.verifyCustomerTaxProfile).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'ctp-new' }),
    );
  });

  it('#17: concurrent duplicate (P2002) → 409', async () => {
    const { svc } = buildHarness({ existingCount: 1, createThrowsP2002: true });
    await expect(svc.create('cust-1', CREATE_INPUT)).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejects the 6th profile (max 5)', async () => {
    const { svc } = buildHarness({ existingCount: 5 });
    await expect(svc.create('cust-1', CREATE_INPUT)).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('CustomerTaxProfileService.update (Phase 161)', () => {
  it('#12: update({isDefault:false}) throws (no silent no-op)', async () => {
    const { svc } = buildHarness({ row: row({ isDefault: true }) });
    await expect(
      svc.update('cust-1', 'ctp-1', { isDefault: false }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('B1/#8: a field edit writes history(UPDATE) + audit', async () => {
    const { svc, customerTaxProfileHistory, audit } = buildHarness({ row: row({ isDefault: true }) });
    await svc.update('cust-1', 'ctp-1', { legalName: 'Acme Private Limited' });
    expect(customerTaxProfileHistory.create.mock.calls[0]![0].data.action).toBe('UPDATE');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: CUSTOMER_TAX_PROFILE_EVENTS.UPDATED }),
    );
  });

  it('promote to default → history(SET_DEFAULT) + default_changed event', async () => {
    const { svc, customerTaxProfileHistory, eventBus } = buildHarness({ row: row({ isDefault: false }) });
    await svc.update('cust-1', 'ctp-1', { isDefault: true });
    expect(customerTaxProfileHistory.create.mock.calls[0]![0].data.action).toBe('SET_DEFAULT');
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(
      CUSTOMER_TAX_PROFILE_EVENTS.DEFAULT_CHANGED,
    );
  });

  it('rejects access to another customer\'s profile', async () => {
    const { svc } = buildHarness({ row: row({ customerId: 'cust-OTHER' }) });
    await expect(
      svc.update('cust-1', 'ctp-1', { legalName: 'x' }),
    ).rejects.toThrow(); // NotFound (ownership)
  });
});

describe('CustomerTaxProfileService.delete + setDefault (Phase 161)', () => {
  it('#8: delete writes a DELETE history row (survives the hard delete) + audit', async () => {
    const { svc, customerTaxProfile, customerTaxProfileHistory, audit } = buildHarness({
      row: row({ isDefault: false }),
    });
    await svc.delete('cust-1', 'ctp-1');
    expect(customerTaxProfile.delete).toHaveBeenCalled();
    expect(customerTaxProfileHistory.create.mock.calls[0]![0].data.action).toBe('DELETE');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: CUSTOMER_TAX_PROFILE_EVENTS.DELETED }),
    );
  });

  it('refuses to delete the default while other profiles exist', async () => {
    const { svc } = buildHarness({ row: row({ isDefault: true }), otherCount: 2 });
    await expect(svc.delete('cust-1', 'ctp-1')).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('setDefault writes history(SET_DEFAULT) + event', async () => {
    const { svc, customerTaxProfileHistory, eventBus } = buildHarness({ row: row({ isDefault: false }) });
    await svc.setDefault('cust-1', 'ctp-1');
    expect(customerTaxProfileHistory.create.mock.calls[0]![0].data.action).toBe('SET_DEFAULT');
    expect(eventBus.publish.mock.calls[0]![0].eventName).toBe(
      CUSTOMER_TAX_PROFILE_EVENTS.DEFAULT_CHANGED,
    );
  });

  it('setDefault on the already-default profile is an idempotent no-op', async () => {
    const { svc, customerTaxProfile } = buildHarness({ row: row({ isDefault: true }) });
    await svc.setDefault('cust-1', 'ctp-1');
    expect(customerTaxProfile.update).not.toHaveBeenCalled();
  });
});

describe('CustomerTaxProfileService.listSharedGstins (Phase 161 #9)', () => {
  it('maps the groupBy aggregate to {gstin, customerCount}', async () => {
    const { svc } = buildHarness({
      grouped: [{ gstin: '29ABCDE1234F1Z5', _count: { customerId: 4 } }],
    });
    const res = await svc.listSharedGstins(2);
    expect(res).toEqual([{ gstin: '29ABCDE1234F1Z5', customerCount: 4 }]);
  });
});
