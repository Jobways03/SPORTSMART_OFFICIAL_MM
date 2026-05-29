// Phase F (P2.3) — unit tests for the affiliate ↔ discount unification
// service. Two responsibilities under test:
//
//   1. `unifyExistingCoupon` creates a mirror Discount row, links the
//      AffiliateCouponCode back to it, and is idempotent.
//   2. `onUnifiedCouponRedeemed` writes ReferralAttribution + bumps the
//      affiliate-side usedCount without throwing if either side fails.

import { DiscountAffiliateUnificationService } from './discount-affiliate-unification.service';
import { NotFoundException } from '@nestjs/common';

type AnyMock = jest.Mock<any, any>;

function makeMocks() {
  const couponFindUnique: AnyMock = jest.fn();
  const couponFindMany: AnyMock = jest.fn().mockResolvedValue([]);
  const couponUpdate: AnyMock = jest.fn();
  const discountCreate: AnyMock = jest.fn();

  const txClient = {
    discount: { create: discountCreate },
    affiliateCouponCode: {
      update: couponUpdate,
      findUnique: couponFindUnique,
    },
    // Phase 67 (audit Gaps #13 + #14) — onUnifiedCouponRedeemed
    // now checks for an existing attribution row before writing.
    // Default null = repo path didn't already write (legacy flow).
    referralAttribution: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  const prisma = {
    affiliateCouponCode: {
      findUnique: couponFindUnique,
      findMany: couponFindMany,
      update: couponUpdate,
    },
    // Phase 67 — same guard fires on the no-tx branch.
    referralAttribution: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(async (cb: any) => cb(txClient)),
  };

  const affiliate = {
    attachAttributionToOrder: jest.fn().mockResolvedValue(undefined),
  };

  return {
    prisma,
    affiliate,
    txClient,
    couponFindUnique,
    couponFindMany,
    couponUpdate,
    discountCreate,
  };
}

describe('DiscountAffiliateUnificationService.unifyExistingCoupon', () => {
  it('returns the existing Discount id if already unified (idempotent)', async () => {
    const m = makeMocks();
    m.couponFindUnique.mockResolvedValue({
      id: 'ac1',
      discountId: 'd-existing',
      affiliate: { id: 'a1', status: 'ACTIVE', commissionPercentage: 10 },
    });
    const svc = new DiscountAffiliateUnificationService(
      m.prisma as any,
      m.affiliate as any,
    );
    const result = await svc.unifyExistingCoupon('ac1');
    expect(result).toEqual({ discountId: 'd-existing' });
    expect(m.discountCreate).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the coupon does not exist', async () => {
    const m = makeMocks();
    m.couponFindUnique.mockResolvedValue(null);
    const svc = new DiscountAffiliateUnificationService(
      m.prisma as any,
      m.affiliate as any,
    );
    await expect(svc.unifyExistingCoupon('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('creates a mirror Discount + links the bridge column', async () => {
    const m = makeMocks();
    m.couponFindUnique.mockResolvedValue({
      id: 'ac1',
      code: 'AFFIL10',
      affiliateId: 'a1',
      discountId: null,
      isActive: true,
      maxUses: 100,
      perUserLimit: 1,
      minOrderValue: 500,
      customerDiscountType: 'PERCENT',
      customerDiscountValue: 10,
      usedCount: 7,
      expiresAt: null,
      affiliate: { id: 'a1', status: 'ACTIVE', commissionPercentage: 15 },
    });
    m.discountCreate.mockResolvedValue({ id: 'new-discount' });

    const svc = new DiscountAffiliateUnificationService(
      m.prisma as any,
      m.affiliate as any,
    );
    const result = await svc.unifyExistingCoupon('ac1');
    expect(result).toEqual({ discountId: 'new-discount' });
    expect(m.discountCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'AFFIL10',
          affiliateId: 'a1',
          affiliateCommissionPercent: 15,
          valueType: 'PERCENTAGE',
          value: 10,
          maxUses: 100,
          minRequirement: 'MIN_PURCHASE_AMOUNT',
          status: 'ACTIVE',
          onePerCustomer: true,
          usedCount: 7,
        }),
      }),
    );
    expect(m.couponUpdate).toHaveBeenCalledWith({
      where: { id: 'ac1' },
      data: { discountId: 'new-discount' },
    });
  });

  it('handles affiliate-only coupons with no customer discount', async () => {
    const m = makeMocks();
    m.couponFindUnique.mockResolvedValue({
      id: 'ac1',
      code: 'TRACKONLY',
      affiliateId: 'a1',
      discountId: null,
      isActive: true,
      maxUses: null,
      perUserLimit: 0,
      minOrderValue: null,
      customerDiscountType: null,
      customerDiscountValue: null,
      usedCount: 0,
      expiresAt: null,
      affiliate: { id: 'a1', status: 'ACTIVE', commissionPercentage: 10 },
    });
    m.discountCreate.mockResolvedValue({ id: 'new-discount' });

    const svc = new DiscountAffiliateUnificationService(
      m.prisma as any,
      m.affiliate as any,
    );
    await svc.unifyExistingCoupon('ac1');
    expect(m.discountCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          value: 0,
          minRequirement: 'NONE',
        }),
      }),
    );
  });
});

describe('DiscountAffiliateUnificationService.unifyAllPending', () => {
  it('reports zero work when nothing is pending', async () => {
    const m = makeMocks();
    m.couponFindMany.mockResolvedValue([]);
    const svc = new DiscountAffiliateUnificationService(
      m.prisma as any,
      m.affiliate as any,
    );
    const result = await svc.unifyAllPending();
    expect(result).toEqual({ total: 0, unified: 0, skipped: 0, errors: [] });
  });

  it('counts unified rows across the loop', async () => {
    const m = makeMocks();
    m.couponFindMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    m.couponFindUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        id: where.id,
        code: `C-${where.id}`,
        affiliateId: 'aff',
        discountId: null,
        isActive: true,
        maxUses: null,
        perUserLimit: 1,
        minOrderValue: null,
        customerDiscountType: 'PERCENT',
        customerDiscountValue: 5,
        usedCount: 0,
        expiresAt: null,
        affiliate: { id: 'aff', status: 'ACTIVE', commissionPercentage: 10 },
      }),
    );
    m.discountCreate.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: `d-${data.code}` }),
    );

    const svc = new DiscountAffiliateUnificationService(
      m.prisma as any,
      m.affiliate as any,
    );
    const result = await svc.unifyAllPending();
    expect(result.total).toBe(2);
    expect(result.unified).toBe(2);
  });
});

describe('DiscountAffiliateUnificationService.onUnifiedCouponRedeemed', () => {
  it('attaches attribution and bumps affiliate-side usedCount', async () => {
    const m = makeMocks();
    m.couponUpdate.mockResolvedValue({ id: 'ac1' });
    const svc = new DiscountAffiliateUnificationService(
      m.prisma as any,
      m.affiliate as any,
    );
    await svc.onUnifiedCouponRedeemed({
      orderId: 'o1',
      discountId: 'd1',
      affiliateId: 'aff1',
      couponCode: 'AFFIL10',
    });
    expect(m.affiliate.attachAttributionToOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orderId: 'o1',
        affiliateId: 'aff1',
        source: 'COUPON',
        code: 'AFFIL10',
      }),
    );
  });

  it('swallows affiliate facade errors so redemption is not blocked', async () => {
    const m = makeMocks();
    m.affiliate.attachAttributionToOrder.mockRejectedValue(new Error('boom'));
    const svc = new DiscountAffiliateUnificationService(
      m.prisma as any,
      m.affiliate as any,
    );
    await expect(
      svc.onUnifiedCouponRedeemed({
        orderId: 'o1',
        discountId: 'd1',
        affiliateId: 'aff1',
        couponCode: 'AFFIL10',
      }),
    ).resolves.toBeUndefined();
  });
});
