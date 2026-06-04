/**
 * Phase 197 (Checkout audit #7) — address STATE mismatch guard.
 *
 * Pre-Phase-197 createAddress / updateAddress trusted the customer's
 * typed state even when it contradicted the authoritative PostOffice
 * record for the pincode. State drives the GST place-of-supply split,
 * so a Delhi pincode saved with state "Maharashtra" would mis-compute
 * CGST/SGST-vs-IGST on every invoice for that address. These specs
 * prove a state contradiction is now rejected, while a case-only
 * difference and a city/district difference still pass.
 */
import 'reflect-metadata';
import { CustomerAddressService } from './customer-address.service';

function buildService(postOffice: any) {
  const repo: any = {
    findAddressByIdAndCustomer: jest.fn(),
    findAddressesByCustomer: jest.fn().mockResolvedValue([]),
    countLiveAddressesForCustomer: jest.fn().mockResolvedValue(0),
    createAddressAtomic: jest
      .fn()
      .mockResolvedValue({ id: 'addr-1', isDefault: false, state: 'X', postalCode: 'Y' }),
    updateAddressAtomic: jest
      .fn()
      .mockResolvedValue({ id: 'addr-1', isDefault: false, state: 'X', postalCode: 'Y' }),
  };
  const prisma: any = {
    indiaState: { findFirst: jest.fn().mockResolvedValue({ gstStateCode: '27' }) },
  };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const storefrontRepo: any = {
    findPostOfficeByPincode: jest
      .fn()
      .mockResolvedValue(postOffice ? [postOffice] : []),
  };
  const svc = new CustomerAddressService(repo, prisma, storefrontRepo, audit);
  return { svc, repo };
}

const DELHI_PO = {
  pincode: '110001',
  officeName: 'Connaught Place',
  district: 'New Delhi',
  state: 'Delhi',
};

const VALID = {
  fullName: 'Anita Sharma',
  phone: '9876543210',
  addressLine1: '12 MG Road',
  city: 'New Delhi',
  state: 'Delhi',
  postalCode: '110001',
};

describe('CustomerAddressService state mismatch (Phase 197 #7)', () => {
  it('rejects a state that contradicts the PostOffice record', async () => {
    const { svc, repo } = buildService(DELHI_PO);
    await expect(
      svc.createAddress('c-1', { ...VALID, state: 'Maharashtra' } as any),
    ).rejects.toThrow(/state for PIN 110001 is Delhi/i);
    expect(repo.createAddressAtomic).not.toHaveBeenCalled();
  });

  it('accepts a state that matches (case-insensitive)', async () => {
    const { svc, repo } = buildService(DELHI_PO);
    await svc.createAddress('c-1', { ...VALID, state: 'delhi' } as any);
    expect(repo.createAddressAtomic).toHaveBeenCalled();
  });

  it('does NOT reject on a city/district difference (city is not a tax determinant)', async () => {
    const { svc, repo } = buildService(DELHI_PO);
    // district is "New Delhi"; customer types a colloquial city — fine.
    await svc.createAddress('c-1', { ...VALID, city: 'Delhi' } as any);
    expect(repo.createAddressAtomic).toHaveBeenCalled();
  });

  it('rejects a contradicting state on update when the pincode changes', async () => {
    const { svc, repo } = buildService(DELHI_PO);
    (repo as any).findAddressByIdAndCustomer = jest
      .fn()
      .mockResolvedValue({ id: 'addr-1', postalCode: '400001' });
    await expect(
      svc.updateAddress('c-1', 'addr-1', {
        postalCode: '110001',
        state: 'Karnataka',
      } as any),
    ).rejects.toThrow(/state for PIN 110001 is Delhi/i);
    expect(repo.updateAddressAtomic).not.toHaveBeenCalled();
  });
});
