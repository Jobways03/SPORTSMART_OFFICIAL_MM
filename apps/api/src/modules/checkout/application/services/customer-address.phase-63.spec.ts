/**
 * Phase 63 (2026-05-22) — pins the address-management flow audit
 * gap closures:
 *
 *   - Self-ownership check at every mutation (pre-existing; not
 *     re-tested here).
 *   - Atomic clear+create for one-default invariant (audit Gap #1).
 *   - deleteAddress → successor promotion (audit Gap #2).
 *   - Soft delete via deletedAt (audit Gap #3).
 *   - Per-customer cap of 50 (audit Gap #12).
 *   - Audit log writes on create/update/delete/set-default (audit
 *     Gap #14).
 *   - +91 phone strip in the service back-compat path (audit
 *     Gap #8).
 *   - PostOffice miss fallback when city+state supplied (audit
 *     Gap #9).
 *   - State-name resolution rejection (audit Gap #18).
 *   - set-default returns { previous, current } (audit Gap #22).
 */

import 'reflect-metadata';
import { CustomerAddressService } from './customer-address.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

const noopLogger: any = undefined;

function buildService(over: {
  findById?: jest.Mock;
  list?: jest.Mock;
  countLive?: jest.Mock;
  createAtomic?: jest.Mock;
  updateAtomic?: jest.Mock;
  softDelete?: jest.Mock;
  setDefault?: jest.Mock;
  postOffice?: any;
  indiaState?: any;
  auditWrite?: jest.Mock;
} = {}) {
  const repo: any = {
    findAddressByIdAndCustomer: over.findById ?? jest.fn(),
    findAddressesByCustomer: over.list ?? jest.fn().mockResolvedValue([]),
    countLiveAddressesForCustomer: over.countLive ?? jest.fn().mockResolvedValue(0),
    createAddress: jest.fn(),
    createAddressAtomic:
      over.createAtomic ?? jest.fn().mockResolvedValue({ id: 'addr-1', isDefault: false }),
    updateAddress: jest.fn(),
    updateAddressAtomic:
      over.updateAtomic ?? jest.fn().mockResolvedValue({ id: 'addr-1', isDefault: false }),
    softDeleteAddressWithDefaultPromotion:
      over.softDelete ?? jest.fn().mockResolvedValue({ promoted: null }),
    setDefaultAddress:
      over.setDefault ??
      jest.fn().mockResolvedValue({ previous: null, current: { id: 'addr-1', isDefault: true } }),
    clearDefaultAddresses: jest.fn(),
    deleteAddress: jest.fn(),
  };
  const prisma: any = {
    postOffice: {
      findFirst: jest.fn().mockResolvedValue(
        over.postOffice ?? {
          pincode: '400001',
          officeName: 'Fort',
          district: 'Mumbai',
          state: 'Maharashtra',
        },
      ),
    },
    indiaState: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.indiaState ?? { gstStateCode: '27' }),
    },
  };
  const audit: any = {
    writeAuditLog: over.auditWrite ?? jest.fn().mockResolvedValue(undefined),
  };
  // Mobile-branch addition — CustomerAddressService now takes a
  // storefrontRepo (3rd constructor arg) so unknown pincodes route
  // through the India Post fallback + auto-seed. Tests that don't
  // exercise pincode flow pass a no-op stub.
  const storefrontRepo: any = {
    findPostOfficeByPincode: jest.fn().mockResolvedValue([]),
  };
  const svc = new CustomerAddressService(repo, prisma, storefrontRepo, audit);
  if (noopLogger !== undefined) (svc as any).logger = noopLogger;
  return { svc, repo, prisma, audit };
}

const VALID = {
  fullName: 'Anita Sharma',
  phone: '9876543210',
  addressLine1: '12 MG Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400001',
};

// ─── Phone normalization (audit Gap #8) ───────────────────────────────

describe('createAddress phone normalization (Phase 63 — Gap #8)', () => {
  it('accepts and stores canonical 10-digit phone from +91-prefixed input', async () => {
    const createAtomic = jest.fn().mockResolvedValue({ id: 'a1', isDefault: false });
    const { svc, repo } = buildService({ createAtomic });
    await svc.createAddress('cust-1', { ...VALID, phone: '+919876543210' });
    expect(repo.createAddressAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '9876543210' }),
    );
  });
});

// ─── Audit Gap #1: atomic default flip ────────────────────────────────

describe('createAddress atomic default flip (Phase 63 — Gap #1)', () => {
  it('delegates to repo.createAddressAtomic (not the non-atomic createAddress)', async () => {
    const { svc, repo } = buildService();
    await svc.createAddress('cust-1', { ...VALID, isDefault: true });
    expect(repo.createAddressAtomic).toHaveBeenCalledTimes(1);
    expect(repo.createAddress).not.toHaveBeenCalled();
  });
});

describe('updateAddress atomic default flip (Phase 63 — Gap #1)', () => {
  it('delegates to repo.updateAddressAtomic when flipping to default', async () => {
    const { svc, repo } = buildService({
      findById: jest.fn().mockResolvedValue({
        ...VALID,
        id: 'addr-1',
        isDefault: false,
        postalCode: '400001',
      }),
    });
    await svc.updateAddress('cust-1', 'addr-1', { isDefault: true });
    expect(repo.updateAddressAtomic).toHaveBeenCalledTimes(1);
    expect(repo.updateAddress).not.toHaveBeenCalled();
  });
});

// ─── Audit Gap #2 + #3: soft delete + successor promotion ────────────

describe('deleteAddress (Phase 63 — Gaps #2 + #3)', () => {
  it('throws NotFound when address is missing or already soft-deleted', async () => {
    const { svc } = buildService({
      findById: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.deleteAddress('cust-1', 'a-missing')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('calls softDeleteAddressWithDefaultPromotion and surfaces promoted id', async () => {
    const softDelete = jest.fn().mockResolvedValue({
      promoted: { id: 'addr-next', isDefault: true },
    });
    const { svc, repo } = buildService({
      findById: jest.fn().mockResolvedValue({
        id: 'addr-1',
        isDefault: true,
        state: 'Maharashtra',
      }),
      softDelete,
    });
    const res = await svc.deleteAddress('cust-1', 'addr-1');
    expect(repo.softDeleteAddressWithDefaultPromotion).toHaveBeenCalledWith(
      'addr-1',
      'cust-1',
    );
    expect(res).toMatchObject({
      deleted: true,
      promotedDefaultId: 'addr-next',
    });
  });

  it('returns promotedDefaultId=null when no successor exists', async () => {
    const { svc } = buildService({
      findById: jest.fn().mockResolvedValue({
        id: 'addr-1',
        isDefault: true,
        state: 'Maharashtra',
      }),
      softDelete: jest.fn().mockResolvedValue({ promoted: null }),
    });
    const res = await svc.deleteAddress('cust-1', 'addr-1');
    expect(res.promotedDefaultId).toBeNull();
  });
});

// ─── Audit Gap #12: per-customer cap ──────────────────────────────────

describe('createAddress cap (Phase 63 — Gap #12)', () => {
  it('throws when the live-address count is at the 50 cap', async () => {
    const { svc } = buildService({
      countLive: jest.fn().mockResolvedValue(50),
    });
    await expect(svc.createAddress('cust-1', VALID)).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('allows the 50th address (cap is inclusive)', async () => {
    const { svc, repo } = buildService({
      countLive: jest.fn().mockResolvedValue(49),
    });
    await svc.createAddress('cust-1', VALID);
    expect(repo.createAddressAtomic).toHaveBeenCalled();
  });
});

// ─── Audit Gap #14: audit log writes ──────────────────────────────────

describe('audit log writes (Phase 63 — Gap #14)', () => {
  it('writes CUSTOMER_ADDRESS_CREATED on create', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({ auditWrite });
    await svc.createAddress('cust-1', VALID);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER_ADDRESS_CREATED',
        actorRole: 'CUSTOMER',
        resource: 'CustomerAddress',
      }),
    );
  });

  it('writes CUSTOMER_ADDRESS_UPDATED on update', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findById: jest.fn().mockResolvedValue({
        ...VALID,
        id: 'addr-1',
        isDefault: false,
        postalCode: '400001',
      }),
      auditWrite,
    });
    await svc.updateAddress('cust-1', 'addr-1', { fullName: 'New Name' });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_ADDRESS_UPDATED' }),
    );
  });

  it('writes CUSTOMER_ADDRESS_DELETED on soft-delete', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findById: jest.fn().mockResolvedValue({ id: 'addr-1', isDefault: true, state: 'X' }),
      auditWrite,
    });
    await svc.deleteAddress('cust-1', 'addr-1');
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_ADDRESS_DELETED' }),
    );
  });

  it('writes CUSTOMER_ADDRESS_SET_DEFAULT on set-default', async () => {
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const { svc } = buildService({
      findById: jest.fn().mockResolvedValue({ id: 'addr-1' }),
      auditWrite,
    });
    await svc.setDefaultAddress('cust-1', 'addr-1');
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_ADDRESS_SET_DEFAULT' }),
    );
  });
});

// ─── Audit Gap #9: PostOffice miss fallback ───────────────────────────

describe('PostOffice miss handling (Phase 63 — Gap #9)', () => {
  it('still rejects when PostOffice misses AND caller did not supply city/state', async () => {
    const { svc, prisma } = buildService();
    prisma.postOffice.findFirst.mockResolvedValue(null);
    await expect(
      svc.createAddress('cust-1', {
        ...VALID,
        city: undefined as any,
        state: undefined as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('accepts when PostOffice misses but caller supplied city + state', async () => {
    const { svc, prisma, repo } = buildService();
    prisma.postOffice.findFirst.mockResolvedValue(null);
    await svc.createAddress('cust-1', VALID);
    expect(repo.createAddressAtomic).toHaveBeenCalled();
  });
});

// ─── Audit Gap #18: stateCode resolution gate ─────────────────────────

describe('state-name resolution rejection (Phase 63 — Gap #18)', () => {
  it('rejects when state name does not resolve to a CBIC code and no stateCode was supplied', async () => {
    const { svc, prisma } = buildService();
    prisma.indiaState.findFirst.mockResolvedValue(null);
    await expect(
      svc.createAddress('cust-1', { ...VALID, state: 'Bombay' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('accepts when stateCode is supplied directly (skips the india_states probe)', async () => {
    const { svc, prisma, repo } = buildService();
    prisma.indiaState.findFirst.mockResolvedValue(null);
    await svc.createAddress('cust-1', { ...VALID, state: 'Bombay', stateCode: '27' });
    expect(repo.createAddressAtomic).toHaveBeenCalled();
  });
});

// ─── Audit Gap #22: set-default returns prev + current ────────────────

describe('setDefaultAddress return shape (Phase 63 — Gap #22)', () => {
  it('returns { previous, current } so the UI can render a delta', async () => {
    const { svc } = buildService({
      findById: jest.fn().mockResolvedValue({ id: 'addr-1' }),
      setDefault: jest.fn().mockResolvedValue({
        previous: { id: 'addr-old', isDefault: false },
        current: { id: 'addr-1', isDefault: true },
      }),
    });
    const res = await svc.setDefaultAddress('cust-1', 'addr-1');
    expect(res).toMatchObject({
      previous: expect.objectContaining({ id: 'addr-old' }),
      current: expect.objectContaining({ id: 'addr-1', isDefault: true }),
    });
  });
});
