// Profile approval lock (2026-06) — once an admin APPROVES a seller, the
// profile is read-only for self-service (profileLocked=true); all changes go
// through the admin. Rejection clears the lock so the seller can fix+resubmit.
//
// These specs lock in: (1) the seller-self-edit path REJECTS when locked,
// (2) approval SETS the lock, (3) rejection CLEARS it.

import { UpdateSellerProfileUseCase } from './update-seller-profile.use-case';
import { ApproveSellerUseCase } from './approve-seller.use-case';
import { RejectSellerUseCase } from './reject-seller.use-case';

const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };

describe('Profile approval lock — UpdateSellerProfileUseCase', () => {
  it('REJECTS a self-edit once the profile is locked (PROFILE_LOCKED_CONTACT_ADMIN)', async () => {
    const sellerRepo: any = {
      findById: jest.fn().mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        profileLocked: true,
      }),
      updateSellerSelect: jest.fn(),
    };
    const prisma: any = { sellerPartnerRegistration: { findFirst: jest.fn() } };
    const uc = new UpdateSellerProfileUseCase(
      sellerRepo,
      prisma,
      eventBus as any,
      logger as any,
    );

    await expect(
      uc.execute('s1', { sellerName: 'New Name' } as any),
    ).rejects.toMatchObject({ code: 'PROFILE_LOCKED_CONTACT_ADMIN' });

    // Locked path short-circuits before any write.
    expect(sellerRepo.updateSellerSelect).not.toHaveBeenCalled();
  });

  it('allows a self-edit while NOT locked (lock check passes through)', async () => {
    const sellerRepo: any = {
      findById: jest.fn().mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        profileLocked: false,
        sellerContactNumber: '999',
        sellerContactCountryCode: '+91',
      }),
      updateSellerSelect: jest.fn().mockResolvedValue({
        id: 's1',
        email: 'a@b.c',
        sellerName: 'New Name',
        status: 'ACTIVE',
      }),
    };
    const prisma: any = {
      sellerPartnerRegistration: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const uc = new UpdateSellerProfileUseCase(
      sellerRepo,
      prisma,
      eventBus as any,
      logger as any,
    );

    await expect(
      uc.execute('s1', { sellerName: 'New Name' } as any),
    ).resolves.toBeTruthy();
    expect(sellerRepo.updateSellerSelect).toHaveBeenCalled();
  });
});

describe('Profile approval lock — Approve/Reject set the flag', () => {
  beforeEach(() => jest.clearAllMocks());

  it('approval SETS profileLocked=true', async () => {
    const sellerRepo: any = {
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's1',
        status: 'PENDING_APPROVAL',
        verificationStatus: 'UNDER_REVIEW',
        isDeleted: false,
        gstin: '29ABCDE1234F1Z5',
        panNumber: 'ABCDE1234F',
      }),
      updateSellerSelect: jest.fn().mockResolvedValue({
        id: 's1',
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      }),
    };
    const uc = new ApproveSellerUseCase(
      sellerRepo,
      eventBus as any,
      audit as any,
      logger as any,
    );

    await uc.execute({ sellerId: 's1', adminId: 'admin-1' });

    const data = sellerRepo.updateSellerSelect.mock.calls[0][1];
    expect(data.profileLocked).toBe(true);
    expect(data.verificationStatus).toBe('VERIFIED');
  });

  it('rejection CLEARS profileLocked=false (so the seller can fix & resubmit)', async () => {
    const sellerRepo: any = {
      findByIdSelect: jest.fn().mockResolvedValue({
        id: 's1',
        status: 'PENDING_APPROVAL',
        verificationStatus: 'UNDER_REVIEW',
        isDeleted: false,
      }),
      updateSellerSelect: jest.fn().mockResolvedValue({
        id: 's1',
        verificationStatus: 'REJECTED',
      }),
    };
    const uc = new RejectSellerUseCase(
      sellerRepo,
      eventBus as any,
      audit as any,
      logger as any,
    );

    await uc.execute({ sellerId: 's1', adminId: 'admin-1', reason: 'Bad GSTIN' });

    const data = sellerRepo.updateSellerSelect.mock.calls[0][1];
    expect(data.profileLocked).toBe(false);
    expect(data.verificationStatus).toBe('REJECTED');
  });
});
