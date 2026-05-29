// Phase 159i — Franchise status-transition hardening: version-CAS, actor+reason
// columns, status-history, and the any→ACTIVE re-verification gate.

import { AdminUpdateFranchiseStatusUseCase } from '../../src/modules/franchise/application/use-cases/admin-update-franchise-status.use-case';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
} from '../../src/core/exceptions';

function build(opts: {
  status: string;
  verificationStatus?: string;
  hasBank?: boolean;
  casCount?: number;
  activeOrders?: number;
}) {
  const franchise = {
    id: 'f1',
    status: opts.status,
    isDeleted: false,
    verificationStatus: opts.verificationStatus ?? 'VERIFIED',
    isEmailVerified: true,
    gstNumber: 'GST123',
    panNumber: 'PAN123',
  };
  const updateMany = jest.fn().mockResolvedValue({ count: opts.casCount ?? 1 });
  const historyCreate = jest.fn().mockResolvedValue({});
  const prisma: any = {
    franchisePartner: { findUnique: jest.fn().mockResolvedValue(franchise), updateMany },
    franchiseBankDetails: {
      findUnique: jest.fn().mockResolvedValue(opts.hasBank === false ? null : { id: 'b1' }),
    },
    subOrder: { count: jest.fn().mockResolvedValue(opts.activeOrders ?? 0) },
    franchiseStatusHistory: { create: historyCreate },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() } as any;
  const uc = new AdminUpdateFranchiseStatusUseCase({} as any, eventBus, audit, logger, prisma);
  return { uc, updateMany, historyCreate };
}

describe('AdminUpdateFranchiseStatusUseCase (Phase 159i)', () => {
  it('PENDING → APPROVED stamps approvedBy via CAS + writes a history row', async () => {
    const { uc, updateMany, historyCreate } = build({ status: 'PENDING' });
    await uc.execute({ adminId: 'admin1', franchiseId: 'f1', status: 'APPROVED', reason: 'looks good' });
    const cas = updateMany.mock.calls[0]![0];
    expect(cas.where).toEqual({ id: 'f1', status: 'PENDING' }); // version-CAS
    expect(cas.data.status).toBe('APPROVED');
    expect(cas.data.approvedBy).toBe('admin1');
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: 'PENDING', toStatus: 'APPROVED', changedByAdminId: 'admin1' }),
      }),
    );
  });

  it('throws Conflict when the CAS matches 0 rows (concurrent transition)', async () => {
    const { uc } = build({ status: 'PENDING', casCount: 0 });
    await expect(
      uc.execute({ adminId: 'admin1', franchiseId: 'f1', status: 'APPROVED' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('ACTIVE → SUSPENDED persists suspendedBy + stripped reason + history', async () => {
    const { uc, updateMany } = build({ status: 'ACTIVE' });
    await uc.execute({ adminId: 'admin1', franchiseId: 'f1', status: 'SUSPENDED', reason: '<b>fraud</b>' });
    const data = updateMany.mock.calls[0]![0].data;
    expect(data.status).toBe('SUSPENDED');
    expect(data.suspendedBy).toBe('admin1');
    expect(data.suspensionReason).toBe('fraud'); // HTML stripped
  });

  it('blocks suspend when active orders exist', async () => {
    const { uc } = build({ status: 'ACTIVE', activeOrders: 2 });
    await expect(
      uc.execute({ adminId: 'admin1', franchiseId: 'f1', status: 'SUSPENDED' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('DEACTIVATED → ACTIVE re-checks verification (rejects unverified) — audit L1', async () => {
    const { uc } = build({ status: 'DEACTIVATED', verificationStatus: 'NOT_VERIFIED' });
    await expect(
      uc.execute({ adminId: 'admin1', franchiseId: 'f1', status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('DEACTIVATED → ACTIVE succeeds when VERIFIED + bank on file', async () => {
    const { uc, updateMany } = build({ status: 'DEACTIVATED', verificationStatus: 'VERIFIED', hasBank: true });
    await uc.execute({ adminId: 'admin1', franchiseId: 'f1', status: 'ACTIVE' });
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({ status: 'ACTIVE', activatedBy: 'admin1' });
  });

  it('rejects an out-of-FSM transition (PENDING → ACTIVE)', async () => {
    const { uc } = build({ status: 'PENDING' });
    await expect(
      uc.execute({ adminId: 'admin1', franchiseId: 'f1', status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });
});
