// Phase 159 — Affiliate Commission Rate audit.
//
// Facade (createCommissionForOrder):
//   - the null-override fallback now reads AffiliateSettings.defaultCommissionPercentage
//     (Critical #2 — was a hardcoded Decimal(10)); the read is cached.
//
// Service (updateCommissionRate):
//   - a real change is transactional: CAS on the prior rate, a history row,
//     the denormalised updater columns, and an audit write (Critical #3 + audit gaps);
//   - a concurrent change loses via the CAS → Conflict;
//   - a no-op (same value) writes neither history nor audit;
//   - out-of-range is rejected before any write.

import { AffiliatePublicFacade } from '../../src/modules/affiliate/application/facades/affiliate-public.facade';
import { AffiliateRegistrationService } from '../../src/modules/affiliate/application/services/affiliate-registration.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../src/core/exceptions';

// ── Facade: platform-default fallback ───────────────────────────
function buildFacade(opts: { defaultRate: number; commissionPercentage: number | null }) {
  const attribution = {
    affiliateId: 'a1',
    source: 'COUPON',
    code: 'AFF10',
    affiliate: { id: 'a1', status: 'ACTIVE', commissionPercentage: opts.commissionPercentage },
  };
  const commissionCreate = jest.fn().mockResolvedValue({ id: 'comm1' });
  const settingsFindUnique = jest
    .fn()
    .mockResolvedValue({ defaultCommissionPercentage: opts.defaultRate });
  const prisma = {
    referralAttribution: { findUnique: jest.fn().mockResolvedValue(attribution) },
    affiliateSettings: { findUnique: settingsFindUnique },
    affiliateCommission: { create: commissionCreate },
    // Phase 159d — createCommissionForOrder re-reads status inside a tx.
    affiliate: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
  } as any;
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const eventBus = { publish: jest.fn() } as any;
  const env = { getNumber: jest.fn().mockReturnValue(0) } as any; // no commission cap
  const facade = new AffiliatePublicFacade(prisma, eventBus, env);
  (facade as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { facade, commissionCreate, settingsFindUnique };
}

describe('AffiliatePublicFacade.createCommissionForOrder — default rate (Phase 159)', () => {
  it('uses the configured AffiliateSettings default (not a hardcoded 10) when the override is null', async () => {
    const { facade, commissionCreate, settingsFindUnique } = buildFacade({
      defaultRate: 15,
      commissionPercentage: null,
    });
    await facade.createCommissionForOrder({
      orderId: 'o1',
      orderSubtotal: 1000,
      returnWindowEndsAt: new Date(),
    });
    expect(settingsFindUnique).toHaveBeenCalled();
    const data = commissionCreate.mock.calls[0]![0].data;
    expect(Number(data.commissionPercentage)).toBe(15); // configured default, NOT 10
    expect(Number(data.commissionAmount)).toBe(150); // 15% of 1000
  });

  it('caches the settings read across orders (one query for two commissions)', async () => {
    const { facade, settingsFindUnique } = buildFacade({
      defaultRate: 12,
      commissionPercentage: null,
    });
    await facade.createCommissionForOrder({ orderId: 'o1', orderSubtotal: 500, returnWindowEndsAt: new Date() });
    await facade.createCommissionForOrder({ orderId: 'o2', orderSubtotal: 500, returnWindowEndsAt: new Date() });
    expect(settingsFindUnique).toHaveBeenCalledTimes(1);
  });

  it('prefers the affiliate override over the platform default', async () => {
    const { facade, commissionCreate, settingsFindUnique } = buildFacade({
      defaultRate: 15,
      commissionPercentage: 8,
    });
    await facade.createCommissionForOrder({ orderId: 'o1', orderSubtotal: 1000, returnWindowEndsAt: new Date() });
    expect(settingsFindUnique).not.toHaveBeenCalled(); // override present → no default lookup
    expect(Number(commissionCreate.mock.calls[0]![0].data.commissionPercentage)).toBe(8);
  });
});

// ── Service: transactional updateCommissionRate ─────────────────
function buildService(opts: { current: number | null; casCount?: number }) {
  const updateMany = jest.fn().mockResolvedValue({ count: opts.casCount ?? 1 });
  const historyCreate = jest.fn().mockResolvedValue({});
  const findUnique = jest
    .fn()
    .mockResolvedValueOnce({ id: 'a1', commissionPercentage: opts.current }) // current
    .mockResolvedValue({ id: 'a1', email: 'aff@x.com', commissionPercentage: opts.current }); // publicSelect
  const tx = {
    affiliate: { findUnique, updateMany },
    affiliateCommissionRateHistory: { create: historyCreate },
  };
  const prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliateRegistrationService(prisma, eventBus, audit);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, updateMany, historyCreate, audit };
}

describe('AffiliateRegistrationService.updateCommissionRate (Phase 159)', () => {
  it('on a real change: CAS on prior value, writes history + updater cols + audit', async () => {
    const { svc, updateMany, historyCreate, audit } = buildService({ current: 10 });
    await svc.updateCommissionRate({
      affiliateId: 'a1',
      percentage: 15,
      adminId: 'admin1',
      reason: 'top performer',
      audit: { ipAddress: '1.2.3.4', userAgent: 'jest' },
    });
    const casArgs = updateMany.mock.calls[0]![0];
    expect(casArgs.where).toEqual({ id: 'a1', commissionPercentage: 10 }); // CAS on prior
    expect(casArgs.data.commissionPercentage).toBe(15);
    expect(casArgs.data.commissionPercentageUpdatedById).toBe('admin1');
    expect(casArgs.data.commissionPercentageUpdatedAt).toBeInstanceOf(Date);
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromRate: 10, toRate: 15, changedByAdminId: 'admin1', reason: 'top performer' }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AFFILIATE_COMMISSION_RATE_UPDATED', resourceId: 'a1' }),
    );
  });

  it('clearing the override (null) is a real change and is recorded', async () => {
    const { svc, updateMany, historyCreate } = buildService({ current: 12 });
    await svc.updateCommissionRate({ affiliateId: 'a1', percentage: null, adminId: 'admin1' });
    expect(updateMany.mock.calls[0]![0].data.commissionPercentage).toBeNull();
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromRate: 12, toRate: null }) }),
    );
  });

  it('is a no-op when the value is unchanged (no history, no audit)', async () => {
    const { svc, updateMany, historyCreate, audit } = buildService({ current: 10 });
    await svc.updateCommissionRate({ affiliateId: 'a1', percentage: 10, adminId: 'admin1' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('throws Conflict when the CAS matches 0 rows (concurrent change)', async () => {
    const { svc } = buildService({ current: 10, casCount: 0 });
    await expect(
      svc.updateCommissionRate({ affiliateId: 'a1', percentage: 15, adminId: 'admin1' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejects an out-of-range percentage before any write', async () => {
    const { svc, updateMany } = buildService({ current: 10 });
    await expect(
      svc.updateCommissionRate({ affiliateId: 'a1', percentage: 150, adminId: 'admin1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
