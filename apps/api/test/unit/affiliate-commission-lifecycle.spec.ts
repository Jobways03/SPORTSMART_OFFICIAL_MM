// Phase 159d — Affiliate Commission Lifecycle audit.
//
// Covers:
//   - the return-window cron: fenced lock gating + per-row
//     affiliate.commission.locked event emission (was a silent bulk updateMany);
//   - createCommissionForOrder populating the explicit referralAttributionId +
//     couponCodeId FKs (was implicit via orderId);
//   - hold/resumeFromHold capturing the acting admin (heldById) + audit_logs.

import { AffiliateReturnWindowService } from '../../src/modules/affiliate/application/services/affiliate-return-window.service';
import { AffiliateCommissionService } from '../../src/modules/affiliate/application/services/affiliate-commission.service';
import { AffiliatePublicFacade } from '../../src/modules/affiliate/application/facades/affiliate-public.facade';

// ── Cron ────────────────────────────────────────────────────────
function buildCron(opts: { candidates?: any[]; acquired?: boolean } = {}) {
  const candidates = opts.candidates ?? [];
  const findMany = jest
    .fn()
    .mockResolvedValueOnce(candidates)
    .mockResolvedValue([]);
  const updateMany = jest.fn().mockResolvedValue({ count: candidates.length });
  const prisma = { affiliateCommission: { findMany, updateMany } } as any;
  const redis = {
    acquireLockWithToken: jest
      .fn()
      .mockResolvedValue({ acquired: opts.acquired ?? true, token: 'tok' }),
    releaseLockWithToken: jest.fn().mockResolvedValue(true),
  } as any;
  const env = {
    getBoolean: jest.fn().mockReturnValue(true),
    getNumber: jest.fn().mockReturnValue(60_000),
  } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliateReturnWindowService(prisma, redis, env, eventBus);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, findMany, updateMany, redis, eventBus };
}

describe('AffiliateReturnWindowService.sweep (Phase 159d)', () => {
  it('confirms a batch, emits affiliate.commission.locked per row, releases the lock', async () => {
    const { svc, updateMany, eventBus, redis } = buildCron({
      candidates: [
        { id: 'c1', affiliateId: 'a1', orderId: 'o1' },
        { id: 'c2', affiliateId: 'a2', orderId: 'o2' },
      ],
    });
    const res = await svc.sweep();
    expect(res.confirmed).toBe(2);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['c1', 'c2'] }, status: 'PENDING' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'affiliate.commission.locked', aggregateId: 'c1' }),
    );
    expect(redis.releaseLockWithToken).toHaveBeenCalled();
  });

  it('no-ops when the distributed lock is held by another pod', async () => {
    const { svc, findMany, eventBus } = buildCron({ acquired: false });
    const res = await svc.sweep();
    expect(res.confirmed).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});

// ── createCommissionForOrder FK population ──────────────────────
describe('AffiliatePublicFacade.createCommissionForOrder — FK linkage (Phase 159d)', () => {
  it('persists referralAttributionId + couponCodeId on the commission', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'comm1' });
    const tx = {
      affiliate: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      affiliateCommission: { create },
    };
    const prisma = {
      referralAttribution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attr1',
          affiliateId: 'a1',
          source: 'COUPON',
          code: 'AF10',
          couponCodeId: 'cc1',
          affiliate: { id: 'a1', status: 'ACTIVE', commissionPercentage: 10 },
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;
    const eventBus = { publish: jest.fn() } as any;
    const env = { getNumber: jest.fn().mockReturnValue(0) } as any;
    const facade = new AffiliatePublicFacade(prisma, eventBus, env);
    (facade as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };

    await facade.createCommissionForOrder({
      orderId: 'o1',
      orderSubtotal: 1000,
      returnWindowEndsAt: new Date(),
    });

    const data = create.mock.calls[0]![0].data;
    expect(data.referralAttributionId).toBe('attr1');
    expect(data.couponCodeId).toBe('cc1');
    expect(data.status).toBe('PENDING');
    expect(Number(data.commissionAmount)).toBe(100); // 10% of 1000
  });
});

// ── hold / resume actor + audit ─────────────────────────────────
function buildCommissionService(status: string) {
  const update = jest.fn(async (args: any) => ({ id: 'c1', status, ...args.data }));
  const prisma = {
    affiliateCommission: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', status }),
      update,
    },
  } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliateCommissionService(prisma, eventBus, audit);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, update, audit };
}

describe('AffiliateCommissionService hold/resume — actor + audit (Phase 159d)', () => {
  it('hold persists heldById and writes an audit row', async () => {
    const { svc, update, audit } = buildCommissionService('PENDING');
    await svc.hold('c1', 'exchange in progress', {
      adminId: 'admin1',
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(update.mock.calls[0]![0].data).toMatchObject({ status: 'HOLD', heldById: 'admin1' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AFFILIATE_COMMISSION_HELD',
        resourceId: 'c1',
        ipAddress: '1.2.3.4',
      }),
    );
  });

  it('resumeFromHold writes an audit row', async () => {
    const { svc, update, audit } = buildCommissionService('HOLD');
    await svc.resumeFromHold('c1', { adminId: 'admin1' });
    expect(update.mock.calls[0]![0].data).toMatchObject({ status: 'PENDING' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AFFILIATE_COMMISSION_RESUMED', resourceId: 'c1' }),
    );
  });
});
