/**
 * Phase 62 (2026-05-22) — affiliate facade hardening:
 *
 *   - Self-referral guard rejects when customerId === affiliate.userId
 *     (audit Gap #1)
 *   - Case-insensitive code lookup (audit Gaps #19 + #27)
 *   - Paise-rounded customer-discount math matches discounts.service
 *     (audit Gap #7)
 *   - Bounds: PERCENT 0-100, FIXED >=0 (audit Gap #22)
 *   - Commission cap clamps via env (audit Gap #14)
 *
 * The row-locked maxUses/perUserLimit (audit Gaps #2 + #3) is
 * exercised in the integration-style spec further down.
 */

import 'reflect-metadata';
import { AffiliatePublicFacade } from './affiliate-public.facade';

function buildFacade(opts: {
  couponCode?: any;
  envCommissionCap?: number;
} = {}) {
  const prisma: any = {
    affiliateCouponCode: {
      findUnique: jest.fn().mockResolvedValue(opts.couponCode ?? null),
    },
    referralAttribution: { findUnique: jest.fn(), count: jest.fn() },
    affiliateCommission: { create: jest.fn(), findUnique: jest.fn() },
    // Phase 159d — createCommissionForOrder now re-reads affiliate status
    // inside a tx before creating.
    affiliate: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    masterOrder: { findUnique: jest.fn() },
    subOrder: { findMany: jest.fn().mockResolvedValue([]) },
  };
  // Phase 159d — $transaction runs its callback against the same mock, so the
  // tests' assertions on prisma.affiliateCommission.create still hold.
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const env: any = {
    getNumber: jest.fn().mockReturnValue(opts.envCommissionCap ?? 0),
  };
  return new AffiliatePublicFacade(prisma, eventBus, env);
}

const ACTIVE_AFFILIATE = {
  id: 'aff-1',
  status: 'ACTIVE',
  userId: 'user-aff-1',
};

// ─── Gap #1: self-referral guard ──────────────────────────────────────

describe('resolveAttribution (Phase 62 — Gap #1 self-referral)', () => {
  it('returns null when customerId === affiliate.userId (COUPON)', async () => {
    const facade = buildFacade({
      couponCode: {
        code: 'AFFCODE',
        isActive: true,
        expiresAt: null,
        affiliate: ACTIVE_AFFILIATE,
        discountId: null,
      },
    });
    const out = await facade.resolveAttribution({
      couponCode: 'AFFCODE',
      customerId: 'user-aff-1',
    });
    expect(out).toBeNull();
  });

  it('returns null when self-referral occurs via LINK source', async () => {
    const facade = buildFacade({
      couponCode: {
        code: 'AFFCODE',
        isActive: true,
        expiresAt: null,
        affiliate: ACTIVE_AFFILIATE,
        discountId: null,
      },
    });
    const out = await facade.resolveAttribution({
      referralCode: 'AFFCODE',
      customerId: 'user-aff-1',
    });
    expect(out).toBeNull();
  });

  it('returns attribution when customer is NOT the affiliate themselves', async () => {
    const facade = buildFacade({
      couponCode: {
        code: 'AFFCODE',
        isActive: true,
        expiresAt: null,
        affiliate: ACTIVE_AFFILIATE,
        discountId: null,
      },
    });
    const out = await facade.resolveAttribution({
      couponCode: 'AFFCODE',
      customerId: 'user-different',
    });
    expect(out).toMatchObject({
      affiliateId: 'aff-1',
      source: 'COUPON',
      code: 'AFFCODE',
    });
  });

  it('preserves attribution when customerId is missing (back-compat)', async () => {
    const facade = buildFacade({
      couponCode: {
        code: 'AFFCODE',
        isActive: true,
        expiresAt: null,
        affiliate: ACTIVE_AFFILIATE,
        discountId: null,
      },
    });
    const out = await facade.resolveAttribution({ couponCode: 'AFFCODE' });
    expect(out).not.toBeNull();
  });
});

// ─── Gap #19 + #27: case-insensitive lookup ───────────────────────────

describe('resolveAttribution (Phase 62 — Gaps #19 + #27 case-insensitive)', () => {
  it('canonicalizes customer-typed lower-case code to upper-case at lookup', async () => {
    const facade = buildFacade({
      couponCode: {
        code: 'SUMMER50',
        isActive: true,
        expiresAt: null,
        affiliate: ACTIVE_AFFILIATE,
        discountId: null,
      },
    });
    await facade.resolveAttribution({
      couponCode: 'summer50',
      customerId: 'user-x',
    });
    expect((facade as any).prisma.affiliateCouponCode.findUnique)
      .toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'SUMMER50' } }));
  });
});

// ─── Gap #7: paise-rounded math ───────────────────────────────────────

describe('validateAffiliateCouponForCustomer (Phase 62 — Gap #7 rounding)', () => {
  it('uses Math.round(*100)/100 not Math.floor for PERCENT', async () => {
    // 10.5% of 1000 = 105 — pre-Phase-62 floor would also give 105
    // for this case. Use a value that exposes the divergence:
    // 7% of 333 = 23.31 → floor 23 vs round 23.31.
    const facade = buildFacade({
      couponCode: {
        id: 'cc-1',
        code: 'PCT7',
        isActive: true,
        expiresAt: null,
        affiliate: ACTIVE_AFFILIATE,
        discountId: null,
        usedCount: 0,
        maxUses: null,
        minOrderValue: null,
        customerDiscountType: 'PERCENT',
        customerDiscountValue: 7,
      },
    });
    const out = await facade.validateAffiliateCouponForCustomer({
      code: 'PCT7',
      subtotal: 333,
    });
    expect(out?.discountAmount).toBe(23.31);
  });
});

// ─── Gap #22: PERCENT 0-100, FIXED >= 0 ───────────────────────────────

describe('validateAffiliateCouponForCustomer (Phase 62 — Gap #22 bounds)', () => {
  it('rejects PERCENT value > 100', async () => {
    const facade = buildFacade({
      couponCode: {
        id: 'cc-1',
        code: 'BAD150',
        isActive: true,
        expiresAt: null,
        affiliate: ACTIVE_AFFILIATE,
        discountId: null,
        usedCount: 0,
        maxUses: null,
        minOrderValue: null,
        customerDiscountType: 'PERCENT',
        customerDiscountValue: 150,
      },
    });
    await expect(
      facade.validateAffiliateCouponForCustomer({ code: 'BAD150', subtotal: 100 }),
    ).rejects.toThrow(/misconfigured/i);
  });

  it('rejects FIXED < 0', async () => {
    const facade = buildFacade({
      couponCode: {
        id: 'cc-1',
        code: 'NEG',
        isActive: true,
        expiresAt: null,
        affiliate: ACTIVE_AFFILIATE,
        discountId: null,
        usedCount: 0,
        maxUses: null,
        minOrderValue: null,
        customerDiscountType: 'FIXED',
        customerDiscountValue: -50,
      },
    });
    await expect(
      facade.validateAffiliateCouponForCustomer({ code: 'NEG', subtotal: 100 }),
    ).rejects.toThrow(/misconfigured/i);
  });
});

// ─── Gap #14: commission cap clamps ───────────────────────────────────

describe('createCommissionForOrder (Phase 62 — Gap #14 commission cap)', () => {
  it('clamps commissionAmount to AFFILIATE_COMMISSION_CAP_PER_ORDER paise', async () => {
    const facade = buildFacade({ envCommissionCap: 100_000 }); // ₹1000
    const prisma = (facade as any).prisma;
    prisma.referralAttribution.findUnique.mockResolvedValue({
      affiliateId: 'aff-1',
      source: 'COUPON',
      code: 'AFFCODE',
      affiliate: { id: 'aff-1', status: 'ACTIVE', commissionPercentage: 10 },
    });
    prisma.affiliateCommission.create.mockResolvedValue({ id: 'comm-1' });

    // 10% of ₹50,000 = ₹5,000; cap clamps to ₹1,000.
    await facade.createCommissionForOrder({
      orderId: 'ord-1',
      orderSubtotal: 50_000,
    });

    const args = prisma.affiliateCommission.create.mock.calls[0][0];
    expect(args.data.commissionAmount.toString()).toBe('1000');
  });

  it('passes through the computed amount when below the cap', async () => {
    const facade = buildFacade({ envCommissionCap: 100_000 });
    const prisma = (facade as any).prisma;
    prisma.referralAttribution.findUnique.mockResolvedValue({
      affiliateId: 'aff-1',
      source: 'COUPON',
      code: 'AFFCODE',
      affiliate: { id: 'aff-1', status: 'ACTIVE', commissionPercentage: 10 },
    });
    prisma.affiliateCommission.create.mockResolvedValue({ id: 'comm-1' });

    // 10% of ₹500 = ₹50 — below ₹1000 cap.
    await facade.createCommissionForOrder({
      orderId: 'ord-1',
      orderSubtotal: 500,
    });

    const args = prisma.affiliateCommission.create.mock.calls[0][0];
    expect(args.data.commissionAmount.toString()).toBe('50');
  });

  it('disables cap when env is 0 (back-compat)', async () => {
    const facade = buildFacade({ envCommissionCap: 0 });
    const prisma = (facade as any).prisma;
    prisma.referralAttribution.findUnique.mockResolvedValue({
      affiliateId: 'aff-1',
      source: 'COUPON',
      code: 'AFFCODE',
      affiliate: { id: 'aff-1', status: 'ACTIVE', commissionPercentage: 10 },
    });
    prisma.affiliateCommission.create.mockResolvedValue({ id: 'comm-1' });

    await facade.createCommissionForOrder({
      orderId: 'ord-1',
      orderSubtotal: 50_000,
    });

    const args = prisma.affiliateCommission.create.mock.calls[0][0];
    expect(args.data.commissionAmount.toString()).toBe('5000');
  });
});

// ─── Gaps #2 + #3: attachAttributionToOrder row lock ──────────────────

describe('attachAttributionToOrder (Phase 62 — Gaps #2 + #3 row lock)', () => {
  function buildTx(opts: {
    maxUses?: number | null;
    usedCount?: number;
    perUserLimit?: number;
    priorUses?: number;
  } = {}) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'cc-1',
          max_uses: opts.maxUses ?? null,
          used_count: opts.usedCount ?? 0,
          per_user_limit: opts.perUserLimit ?? 0,
        },
      ]),
      affiliateCouponCode: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      referralAttribution: {
        count: jest.fn().mockResolvedValue(opts.priorUses ?? 0),
        create: jest.fn().mockResolvedValue(undefined),
      },
    } as any;
  }

  it('throws AFFILIATE_MAX_USES_REACHED when usedCount >= maxUses inside the lock', async () => {
    const facade = buildFacade();
    const tx = buildTx({ maxUses: 1, usedCount: 1 });
    await expect(
      facade.attachAttributionToOrder(tx, {
        orderId: 'ord-1',
        affiliateId: 'aff-1',
        source: 'COUPON',
        code: 'AFFCODE',
        customerId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'AFFILIATE_MAX_USES_REACHED' });
    expect(tx.referralAttribution.create).not.toHaveBeenCalled();
  });

  it('throws AFFILIATE_PER_USER_LIMIT_REACHED when prior uses reach the cap', async () => {
    const facade = buildFacade();
    const tx = buildTx({ perUserLimit: 1, priorUses: 1 });
    await expect(
      facade.attachAttributionToOrder(tx, {
        orderId: 'ord-2',
        affiliateId: 'aff-1',
        source: 'COUPON',
        code: 'AFFCODE',
        customerId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'AFFILIATE_PER_USER_LIMIT_REACHED' });
  });

  it('writes attribution + increments usedCount when caps are satisfied', async () => {
    const facade = buildFacade();
    const tx = buildTx({ maxUses: 10, usedCount: 0, perUserLimit: 1, priorUses: 0 });
    await facade.attachAttributionToOrder(tx, {
      orderId: 'ord-3',
      affiliateId: 'aff-1',
      source: 'COUPON',
      code: 'affcode', // lower-case input
      customerId: 'user-1',
    });
    // usedCount incremented inside the lock
    expect(tx.affiliateCouponCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { usedCount: { increment: 1 } },
      }),
    );
    // ReferralAttribution row written with canonical code + customerId
    expect(tx.referralAttribution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'ord-3',
          affiliateId: 'aff-1',
          source: 'COUPON',
          code: 'AFFCODE',
          customerId: 'user-1',
        }),
      }),
    );
  });

  it('skips perUserLimit when limit is 0 (unlimited)', async () => {
    const facade = buildFacade();
    const tx = buildTx({ perUserLimit: 0, priorUses: 999 });
    await facade.attachAttributionToOrder(tx, {
      orderId: 'ord-4',
      affiliateId: 'aff-1',
      source: 'COUPON',
      code: 'AFFCODE',
      customerId: 'user-1',
    });
    expect(tx.referralAttribution.create).toHaveBeenCalled();
  });

  it('skips lock+limits entirely for LINK source attributions', async () => {
    const facade = buildFacade();
    const tx = buildTx({ maxUses: 0, usedCount: 999 });
    await facade.attachAttributionToOrder(tx, {
      orderId: 'ord-5',
      affiliateId: 'aff-1',
      source: 'LINK',
      code: null,
      customerId: 'user-1',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.referralAttribution.create).toHaveBeenCalled();
  });
});
