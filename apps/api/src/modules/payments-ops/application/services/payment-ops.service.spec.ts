/**
 * Phase 15 (2026-05-16) — first behavioural test for the payments-ops
 * module. Pre-Phase-15 the module had zero specs.
 *
 * `transitionAlert` is the single state-flip entry point ops use
 * when working a PaymentMismatchAlert. The branch logic decides:
 *
 *   • RESOLVED / IGNORED → stamp resolvedByAdminId + resolvedAt
 *     to now (terminal state).
 *   • Anything else → clear resolvedAt + retain the prior admin id.
 *
 * We cover both branches plus the "alert not found" path.
 */
import 'reflect-metadata';
import { PaymentOpsService } from './payment-ops.service';
import { NotFoundAppException } from '../../../../core/exceptions';

function buildService(opts: { existing?: any } = {}) {
  const prisma = {
    paymentMismatchAlert: {
      findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: opts.existing?.id,
        ...opts.existing,
        ...data,
      })),
    },
  } as any;
  const service = new PaymentOpsService(prisma);
  return { service, prisma };
}

const PENDING_ALERT = {
  id: 'alert-1',
  status: 'PENDING',
  resolutionNotes: null,
  resolvedByAdminId: null,
  resolvedAt: null,
};

describe('PaymentOpsService.transitionAlert (Phase 15)', () => {
  it('throws NotFoundAppException when the alert does not exist', async () => {
    const { service } = buildService();
    await expect(
      service.transitionAlert({
        id: 'missing',
        status: 'RESOLVED' as any,
      }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('stamps resolvedByAdminId + resolvedAt when transitioning to RESOLVED', async () => {
    const { service, prisma } = buildService({ existing: PENDING_ALERT });
    await service.transitionAlert({
      id: 'alert-1',
      status: 'RESOLVED' as any,
      adminId: 'admin-42',
      notes: 'reconciled with bank statement',
    });
    expect(prisma.paymentMismatchAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        resolvedByAdminId: 'admin-42',
        resolvedAt: expect.any(Date),
        resolutionNotes: 'reconciled with bank statement',
      }),
    });
  });

  it('stamps resolvedByAdminId + resolvedAt when transitioning to IGNORED', async () => {
    const { service, prisma } = buildService({ existing: PENDING_ALERT });
    await service.transitionAlert({
      id: 'alert-1',
      status: 'IGNORED' as any,
      adminId: 'admin-99',
    });
    expect(prisma.paymentMismatchAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: expect.objectContaining({
        status: 'IGNORED',
        resolvedByAdminId: 'admin-99',
        resolvedAt: expect.any(Date),
      }),
    });
  });

  it('clears resolvedAt when transitioning to a non-terminal status (e.g. RE-OPEN)', async () => {
    const resolved = {
      ...PENDING_ALERT,
      status: 'RESOLVED',
      resolvedByAdminId: 'admin-1',
      resolvedAt: new Date(),
    };
    const { service, prisma } = buildService({ existing: resolved });
    await service.transitionAlert({
      id: 'alert-1',
      status: 'PENDING' as any,
      adminId: 'admin-2',
    });
    expect(prisma.paymentMismatchAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: expect.objectContaining({
        status: 'PENDING',
        resolvedAt: null,
        resolvedByAdminId: 'admin-1', // preserved from prior state
      }),
    });
  });

  it('keeps the existing resolutionNotes when no new notes are supplied', async () => {
    const { service, prisma } = buildService({
      existing: { ...PENDING_ALERT, resolutionNotes: 'see ticket #42' },
    });
    await service.transitionAlert({
      id: 'alert-1',
      status: 'RESOLVED' as any,
      adminId: 'admin-1',
    });
    expect(prisma.paymentMismatchAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: expect.objectContaining({
        resolutionNotes: 'see ticket #42',
      }),
    });
  });
});
