// Phase 156 — affiliate status transitions write the actor to a DEDICATED
// column (not the overloaded approvedById) and append an ordered status-history
// row. (Confirms the audit's Critical #1 fix is in + the #12 history.)

import { AffiliateRegistrationService } from '../../src/modules/affiliate/application/services/affiliate-registration.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../src/core/exceptions';

function build(status: string) {
  const affiliate = { id: 'a1', status, email: 'aff@example.com' };
  const historyCreate = jest.fn().mockResolvedValue({});
  const update = jest.fn(async (args: any) => ({ ...affiliate, ...args.data }));
  const affiliateUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const commissionUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const payoutUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma: any = {
    affiliate: {
      findUnique: jest.fn().mockResolvedValue(affiliate),
      update,
      updateMany: affiliateUpdateMany,
    },
    affiliateStatusHistory: { create: historyCreate },
    affiliateSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    // Phase 159h — suspend/reactivate are transactional + touch payouts/commissions.
    affiliatePayoutRequest: { findMany: jest.fn().mockResolvedValue([]), updateMany: payoutUpdateMany },
    affiliateCommission: { updateMany: commissionUpdateMany },
    affiliateTds194OLedger: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliateRegistrationService(prisma, eventBus, audit);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, update, historyCreate, affiliateUpdateMany, commissionUpdateMany, payoutUpdateMany };
}

describe('AffiliateRegistrationService — status transitions (Phase 156)', () => {
  it('reject writes rejectedById (NOT approvedById) + a REJECTED history row', async () => {
    const { svc, update, historyCreate } = build('PENDING_APPROVAL');
    await svc.reject('a1', 'spam application', 'admin9');
    const data = update.mock.calls[0]![0].data;
    expect(data.status).toBe('REJECTED');
    expect(data.rejectedById).toBe('admin9');
    expect(data.approvedById).toBeUndefined(); // Critical #1 — no overload
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toStatus: 'REJECTED',
          fromStatus: 'PENDING_APPROVAL',
          changedByAdminId: 'admin9',
        }),
      }),
    );
  });

  it('suspend writes suspendedById via a status-CAS + HOLDs commissions + SUSPENDED history', async () => {
    const { svc, affiliateUpdateMany, commissionUpdateMany, historyCreate } = build('ACTIVE');
    await svc.suspend('a1', 'fraud signals', 'admin9');
    const cas = affiliateUpdateMany.mock.calls[0]![0];
    expect(cas.where).toEqual({ id: 'a1', status: 'ACTIVE' }); // CAS guard
    expect(cas.data.status).toBe('SUSPENDED');
    expect(cas.data.suspendedById).toBe('admin9');
    expect(cas.data.approvedById).toBeUndefined(); // no overload
    // Pending/confirmed commissions are HELD on suspend.
    expect(commissionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'HOLD' }) }),
    );
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toStatus: 'SUSPENDED', changedByAdminId: 'admin9' }),
      }),
    );
  });

  it('suspend rejects a non-ACTIVE affiliate', async () => {
    const { svc } = build('PENDING_APPROVAL');
    await expect(svc.suspend('a1', 'x', 'admin9')).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

function buildApprove(opts: { status?: string; claimCount?: number; existingPrimary?: boolean } = {}) {
  const affiliate = { id: 'a1', status: opts.status ?? 'PENDING_APPROVAL', email: 'aff@example.com' };
  const updateMany = jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 });
  const findUniqueOrThrow = jest.fn(async () => ({ ...affiliate, status: 'ACTIVE' }));
  const couponFindFirst = jest.fn().mockResolvedValue(opts.existingPrimary ? { id: 'c1' } : null);
  const couponCreate = jest.fn().mockResolvedValue({});
  const historyCreate = jest.fn().mockResolvedValue({});
  const tx = {
    affiliate: { updateMany, findUniqueOrThrow },
    affiliateCouponCode: { findFirst: couponFindFirst, create: couponCreate },
  };
  const prisma = {
    affiliate: { findUnique: jest.fn().mockResolvedValue(affiliate) },
    affiliateStatusHistory: { create: historyCreate },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliateRegistrationService(prisma, eventBus, audit);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, updateMany, couponCreate, historyCreate };
}

describe('AffiliateRegistrationService.approve (Phase 157)', () => {
  it('flips PENDING_APPROVAL → ACTIVE via a status-CAS + creates the primary coupon', async () => {
    const { svc, updateMany, couponCreate, historyCreate } = buildApprove();
    await svc.approve('a1', 'admin1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1', status: 'PENDING_APPROVAL' },
        data: expect.objectContaining({ status: 'ACTIVE', approvedById: 'admin1' }),
      }),
    );
    expect(couponCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPrimary: true }) }),
    );
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStatus: 'ACTIVE' }) }),
    );
  });

  it('throws Conflict when the status-CAS affects 0 rows (concurrent approve)', async () => {
    const { svc } = buildApprove({ claimCount: 0 });
    await expect(svc.approve('a1', 'admin1')).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejects re-approving an already-ACTIVE affiliate', async () => {
    const { svc } = buildApprove({ status: 'ACTIVE' });
    await expect(svc.approve('a1', 'admin1')).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('does not create a second primary coupon when one already exists (idempotent)', async () => {
    const { svc, couponCreate } = buildApprove({ existingPrimary: true });
    await svc.approve('a1', 'admin1');
    expect(couponCreate).not.toHaveBeenCalled();
  });
});
