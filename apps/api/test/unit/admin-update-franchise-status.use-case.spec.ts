import 'reflect-metadata';
import { AdminUpdateFranchiseStatusUseCase } from '../../src/modules/franchise/application/use-cases/admin-update-franchise-status.use-case';

/**
 * Phase 20 (2026-05-20) — AdminUpdateFranchiseStatusUseCase tests.
 *
 * Pins the activation-path preconditions:
 *   - PENDING → APPROVED requires isEmailVerified + verification=VERIFIED
 *     + gstNumber + panNumber.
 *   - APPROVED → ACTIVE requires bank details.
 *   - Disallowed transitions throw ForbiddenAppException.
 *   - APPROVED stamps approvedAt/By, ACTIVE stamps activatedAt/By.
 *   - Active orders block DEACTIVATED/SUSPENDED.
 */

describe('AdminUpdateFranchiseStatusUseCase', () => {
  const buildUseCase = (overrides: Partial<any> = {}) => {
    // Phase 159i — the use-case now reads/writes via prisma directly (CAS +
    // status-history in a tx). Reuse each test's `findById` mock as the
    // prisma.franchisePartner.findUnique mock.
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const statusHistoryCreate = jest.fn().mockResolvedValue({});
    const franchiseRepo = { findById: jest.fn(), updateFranchise: jest.fn() } as any;
    const eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    const audit = {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    } as any;
    const prismaOverrides = (overrides as any).prisma ?? {};
    const prisma: any = {
      franchisePartner: {
        findUnique: (overrides as any).findById ?? jest.fn().mockResolvedValue(null),
        updateMany,
      },
      franchiseBankDetails: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      subOrder: {
        count: jest.fn().mockResolvedValue(0),
      },
      franchiseStatusHistory: { create: statusHistoryCreate },
      ...prismaOverrides,
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    return {
      useCase: new AdminUpdateFranchiseStatusUseCase(
        franchiseRepo,
        eventBus,
        audit,
        logger,
        prisma,
      ),
      franchiseRepo,
      updateMany,
      statusHistoryCreate,
      eventBus,
      audit,
      prisma,
    };
  };

  const baseFranchise = (overrides: Partial<any> = {}) => ({
    id: 'f-1',
    isDeleted: false,
    status: 'PENDING',
    verificationStatus: 'VERIFIED',
    isEmailVerified: true,
    gstNumber: '29ABCDE1234F1Z5',
    panNumber: 'ABCDE1234F',
    ...overrides,
  });

  it('throws when franchise not found', async () => {
    const { useCase } = buildUseCase({
      findById: jest.fn().mockResolvedValue(null),
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        status: 'APPROVED',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('blocks unverified email when PENDING → APPROVED', async () => {
    const { useCase } = buildUseCase({
      findById: jest
        .fn()
        .mockResolvedValue(baseFranchise({ isEmailVerified: false })),
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        status: 'APPROVED',
      }),
    ).rejects.toThrow(/email is not verified/i);
  });

  it('blocks non-VERIFIED verification when PENDING → APPROVED', async () => {
    const { useCase } = buildUseCase({
      findById: jest.fn().mockResolvedValue(
        baseFranchise({ verificationStatus: 'UNDER_REVIEW' }),
      ),
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        status: 'APPROVED',
      }),
    ).rejects.toThrow(/Verification must be VERIFIED/i);
  });

  it('blocks missing GSTIN when PENDING → APPROVED', async () => {
    const { useCase } = buildUseCase({
      findById: jest.fn().mockResolvedValue(baseFranchise({ gstNumber: null })),
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        status: 'APPROVED',
      }),
    ).rejects.toThrow(/GSTIN on file/i);
  });

  it('blocks missing PAN when PENDING → APPROVED', async () => {
    const { useCase } = buildUseCase({
      findById: jest.fn().mockResolvedValue(baseFranchise({ panNumber: null })),
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        status: 'APPROVED',
      }),
    ).rejects.toThrow(/PAN on file/i);
  });

  it('PENDING → APPROVED: stamps approvedAt + approvedBy + audit event fires', async () => {
    const { useCase, updateMany, eventBus, audit } = buildUseCase({
      findById: jest.fn().mockResolvedValue(baseFranchise()),
    });
    await useCase.execute({
      adminId: 'admin-1',
      franchiseId: 'f-1',
      status: 'APPROVED',
    });
    const patch = updateMany.mock.calls[0]![0].data;
    expect(patch.status).toBe('APPROVED');
    expect(patch.approvedAt).toBeInstanceOf(Date);
    expect(patch.approvedBy).toBe('admin-1');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'franchise.status_updated' }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_APPROVED' }),
    );
  });

  it('blocks APPROVED → ACTIVE when bank details missing', async () => {
    const { useCase } = buildUseCase({
      findById: jest.fn().mockResolvedValue(
        baseFranchise({ status: 'APPROVED' }),
      ),
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        status: 'ACTIVE',
      }),
    ).rejects.toThrow(/bank details on file/i);
  });

  it('APPROVED → ACTIVE: stamps activatedAt + activatedBy when bank details exist', async () => {
    const { useCase, updateMany, audit } = buildUseCase({
      findById: jest.fn().mockResolvedValue(
        baseFranchise({ status: 'APPROVED' }),
      ),
      prisma: {
        franchiseBankDetails: {
          findUnique: jest.fn().mockResolvedValue({ id: 'bd-1' }),
        },
        subOrder: { count: jest.fn().mockResolvedValue(0) },
      },
    });
    await useCase.execute({
      adminId: 'admin-1',
      franchiseId: 'f-1',
      status: 'ACTIVE',
    });
    const patch = updateMany.mock.calls[0]![0].data;
    expect(patch.status).toBe('ACTIVE');
    expect(patch.activatedAt).toBeInstanceOf(Date);
    expect(patch.activatedBy).toBe('admin-1');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_ACTIVATED' }),
    );
  });

  it('rejects disallowed transitions', async () => {
    const { useCase } = buildUseCase({
      findById: jest.fn().mockResolvedValue(
        baseFranchise({ status: 'PENDING' }),
      ),
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        status: 'ACTIVE', // PENDING cannot jump to ACTIVE.
      }),
    ).rejects.toThrow(/Cannot transition from PENDING to ACTIVE/);
  });

  it('blocks DEACTIVATED when active orders exist', async () => {
    const { useCase } = buildUseCase({
      findById: jest.fn().mockResolvedValue(
        baseFranchise({ status: 'ACTIVE' }),
      ),
      prisma: {
        franchiseBankDetails: { findUnique: jest.fn().mockResolvedValue({ id: 'bd-1' }) },
        subOrder: { count: jest.fn().mockResolvedValue(3) },
      },
    });
    await expect(
      useCase.execute({
        adminId: 'a',
        franchiseId: 'f-1',
        status: 'DEACTIVATED',
      }),
    ).rejects.toThrow(/3 active order/);
  });
});
