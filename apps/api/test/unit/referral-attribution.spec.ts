// Phase 159c — Referral Attribution audit.
//
// Covers:
//   - the shared attachReferralAttribution helper (consolidated from the two
//     previously-duplicated copies): FOR UPDATE maxUses + perUserLimit caps,
//     usedCount increment, couponCodeId persistence, P2002-idempotent insert;
//   - resolveAttribution self-referral guard (regression) + couponCodeId return;
//   - cancelOrReverseForOrder marking the attribution REVERSED.

import { attachReferralAttribution } from '../../src/modules/affiliate/application/attach-referral-attribution';
import { AffiliatePublicFacade } from '../../src/modules/affiliate/application/facades/affiliate-public.facade';

// ── Shared helper ───────────────────────────────────────────────
function txMock(opts: { locked?: any[]; priorUses?: number; create?: jest.Mock } = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(opts.locked ?? []),
    affiliateCouponCode: { update: jest.fn().mockResolvedValue({}) },
    referralAttribution: {
      count: jest.fn().mockResolvedValue(opts.priorUses ?? 0),
      create: opts.create ?? jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('attachReferralAttribution (Phase 159c shared helper)', () => {
  it('throws MAX_USES_REACHED when used_count >= max_uses (under the lock)', async () => {
    const tx = txMock({ locked: [{ id: 'c1', max_uses: 100, used_count: 100, per_user_limit: 0 }] });
    await expect(
      attachReferralAttribution(tx, {
        orderId: 'o1', affiliateId: 'a1', source: 'COUPON', code: 'AF10', customerId: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'AFFILIATE_MAX_USES_REACHED' });
  });

  it('throws PER_USER_LIMIT_REACHED when the customer hit their cap', async () => {
    const tx = txMock({
      locked: [{ id: 'c1', max_uses: null, used_count: 5, per_user_limit: 1 }],
      priorUses: 1,
    });
    await expect(
      attachReferralAttribution(tx, {
        orderId: 'o1', affiliateId: 'a1', source: 'COUPON', code: 'AF10', customerId: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'AFFILIATE_PER_USER_LIMIT_REACHED' });
  });

  it('persists couponCodeId + canonical code + customerId and increments usedCount', async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = txMock({ locked: [{ id: 'c1', max_uses: null, used_count: 0, per_user_limit: 0 }], create });
    await attachReferralAttribution(tx, {
      orderId: 'o1', affiliateId: 'a1', source: 'COUPON', code: 'af10', customerId: 'u1', couponCodeId: 'cc1',
    });
    expect(tx.affiliateCouponCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: { usedCount: { increment: 1 } } }),
    );
    expect(create.mock.calls[0]![0].data).toMatchObject({
      couponCodeId: 'cc1',
      code: 'AF10', // canonicalised
      customerId: 'u1',
    });
  });

  it('swallows P2002 on the attribution insert (idempotent)', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    const tx = txMock({ create });
    await expect(
      attachReferralAttribution(tx, { orderId: 'o1', affiliateId: 'a1', source: 'LINK', code: null }),
    ).resolves.toBeUndefined();
  });

  it('rethrows a non-P2002 insert error', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2003' });
    const tx = txMock({ create });
    await expect(
      attachReferralAttribution(tx, { orderId: 'o1', affiliateId: 'a1', source: 'LINK', code: null }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

// ── Facade: resolveAttribution + cancelOrReverseForOrder ─────────
function buildFacade(prisma: any) {
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const env = { getNumber: jest.fn().mockReturnValue(0) } as any;
  const f = new AffiliatePublicFacade(prisma, eventBus, env);
  (f as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return f;
}

describe('AffiliatePublicFacade.resolveAttribution — self-referral + couponCodeId (Phase 159c)', () => {
  const couponRow = {
    id: 'cc1',
    code: 'AF10',
    isActive: true,
    expiresAt: null,
    discountId: null,
    affiliate: { id: 'a1', status: 'ACTIVE', userId: 'u1' },
  };

  it('blocks self-referral (customer is the affiliate user)', async () => {
    const facade = buildFacade({
      affiliateCouponCode: { findUnique: jest.fn().mockResolvedValue(couponRow) },
    });
    const res = await facade.resolveAttribution({ couponCode: 'AF10', customerId: 'u1' });
    expect(res).toBeNull();
  });

  it('attributes a non-self customer and returns couponCodeId', async () => {
    const facade = buildFacade({
      affiliateCouponCode: { findUnique: jest.fn().mockResolvedValue(couponRow) },
    });
    const res = await facade.resolveAttribution({ couponCode: 'AF10', customerId: 'u2' });
    expect(res).toMatchObject({ affiliateId: 'a1', source: 'COUPON', code: 'AF10', couponCodeId: 'cc1' });
  });
});

describe('AffiliatePublicFacade.cancelOrReverseForOrder — attribution reversal (Phase 159c)', () => {
  it('marks the attribution REVERSED even when no commission exists (pre-payment cancel)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const facade = buildFacade({
      referralAttribution: { updateMany },
      affiliateCommission: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await facade.cancelOrReverseForOrder('o1', 'order cancelled');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'o1', status: { not: 'REVERSED' } },
        data: { status: 'REVERSED' },
      }),
    );
  });
});
