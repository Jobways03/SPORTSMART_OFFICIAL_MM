/**
 * Phase 15 (2026-05-16) — first behavioural test for the payments-ops module.
 * Phase 169 (Payment Ops audit #5) — `transitionAlert` is now CAS-guarded
 * (updateMany WHERE status=from + count check) instead of findUnique→update, so
 * two admins can't both win a RESOLVE. These specs assert the new contract:
 *   • terminal (RESOLVED/IGNORED) → stamp resolvedByAdminId + resolvedAt
 *   • non-terminal → clear resolvedAt, preserve prior admin id
 *   • CAS miss (count=0) → BadRequest concurrent-modification
 *   • not found → NotFound
 */
import 'reflect-metadata';
import { PaymentOpsService } from './payment-ops.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

function buildService(opts: { existing?: any; flipCount?: number } = {}) {
  const updated: any = {};
  const prisma = {
    paymentMismatchAlert: {
      findUnique: jest.fn().mockImplementation(async () =>
        // first call returns the pre-image; after updateMany, return the merged
        // row so the final read reflects the write.
        updated.data
          ? { ...opts.existing, ...updated.data }
          : opts.existing ?? null,
      ),
      updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
        const count = opts.flipCount ?? 1;
        if (count > 0) updated.data = data;
        return { count };
      }),
    },
  } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentOpsService(prisma, audit as any);
  return { service, prisma, audit };
}

const OPEN_ALERT = {
  id: 'alert-1',
  kind: 'AMOUNT_MISMATCH',
  severity: 90,
  status: 'OPEN',
  resolutionNotes: null,
  resolvedByAdminId: null,
  resolvedAt: null,
};

describe('PaymentOpsService.transitionAlert (Phase 169 CAS)', () => {
  it('throws NotFoundAppException when the alert does not exist', async () => {
    const { service } = buildService();
    await expect(
      service.transitionAlert({ id: 'missing', status: 'RESOLVED' as any }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('CAS-guards the update on the current status + stamps resolver on RESOLVED', async () => {
    const { service, prisma, audit } = buildService({ existing: OPEN_ALERT });
    await service.transitionAlert({
      id: 'alert-1',
      status: 'RESOLVED' as any,
      adminId: 'admin-42',
      notes: 'reconciled with bank statement',
    });
    expect(prisma.paymentMismatchAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'alert-1', status: 'OPEN' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        resolvedByAdminId: 'admin-42',
        resolvedAt: expect.any(Date),
        resolutionNotes: 'reconciled with bank statement',
      }),
    });
    // #audit-gap — every transition writes an audit row.
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_MISMATCH_TRANSITION', resourceId: 'alert-1' }),
    );
  });

  it('honours an explicit expectedFromStatus in the CAS guard', async () => {
    const inReview = { ...OPEN_ALERT, status: 'IN_REVIEW' };
    const { service, prisma } = buildService({ existing: inReview });
    await service.transitionAlert({
      id: 'alert-1',
      status: 'IGNORED' as any,
      adminId: 'admin-99',
      expectedFromStatus: 'IN_REVIEW' as any,
    });
    expect(prisma.paymentMismatchAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'alert-1', status: 'IN_REVIEW' } }),
    );
  });

  it('clears resolvedAt on a non-terminal (re-open) transition, preserving prior admin id', async () => {
    const resolved = {
      ...OPEN_ALERT,
      status: 'RESOLVED',
      resolvedByAdminId: 'admin-1',
      resolvedAt: new Date(),
    };
    const { service, prisma } = buildService({ existing: resolved });
    await service.transitionAlert({ id: 'alert-1', status: 'IN_REVIEW' as any, adminId: 'admin-2' });
    expect(prisma.paymentMismatchAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'IN_REVIEW',
          resolvedAt: null,
          resolvedByAdminId: 'admin-1',
        }),
      }),
    );
  });

  it('throws BadRequest (concurrent modification) when the CAS matches nothing', async () => {
    const { service } = buildService({ existing: OPEN_ALERT, flipCount: 0 });
    await expect(
      service.transitionAlert({ id: 'alert-1', status: 'RESOLVED' as any, adminId: 'admin-1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  // Phase 169 review (L2#1) — a no-op self-transition is rejected so the audit
  // trail isn't polluted with no-change "transitions".
  it('rejects a no-op self-transition (status === current)', async () => {
    const { service, prisma } = buildService({ existing: OPEN_ALERT });
    await expect(
      service.transitionAlert({ id: 'alert-1', status: 'OPEN' as any, adminId: 'admin-1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(prisma.paymentMismatchAlert.updateMany).not.toHaveBeenCalled();
  });
});

describe('PaymentOpsService.bulkTransition (Phase 169 #16)', () => {
  it('reports per-id success + skip counts', async () => {
    // alert-2 will CAS-miss (flipCount 0 only affects the shared mock, so use a
    // custom prisma that fails the second id).
    const prisma = {
      paymentMismatchAlert: {
        findUnique: jest.fn().mockResolvedValue(OPEN_ALERT),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
    } as any;
    const service = new PaymentOpsService(prisma, {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    } as any);
    const res = await service.bulkTransition({
      ids: ['a', 'b'],
      status: 'IGNORED' as any,
      adminId: 'admin-1',
    });
    expect(res.updated).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.results).toHaveLength(2);
  });
});

describe('PaymentOpsService.createMismatchAlert (Phase 169 #10/#13)', () => {
  it('bounds the description, clamps severity, and records provenance', async () => {
    const created: any = {};
    const prisma = {
      paymentMismatchAlert: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          Object.assign(created, data);
          return { id: 'a1', ...data };
        }),
      },
    } as any;
    const service = new PaymentOpsService(prisma);
    await service.createMismatchAlert({
      kind: 'AMOUNT_MISMATCH' as any,
      description: 'x'.repeat(5000),
      severity: 250,
      sourceType: 'WEBHOOK' as any,
    });
    expect(created.description.length).toBeLessThanOrEqual(2000);
    expect(created.severity).toBe(100); // clamped
    expect(created.sourceType).toBe('WEBHOOK');
  });
});

describe('PaymentOpsService.listFailedPayments (Phase 169 #3)', () => {
  it('queries FAILURE attempts of the gateway kinds, newest first', async () => {
    const prisma = {
      paymentAttempt: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    } as any;
    const service = new PaymentOpsService(prisma);
    await service.listFailedPayments({ page: 1, limit: 20 });
    expect(prisma.paymentAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'FAILURE',
          kind: { in: ['CREATE_ORDER', 'CAPTURE', 'VERIFY_SIGNATURE'] },
        }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});
