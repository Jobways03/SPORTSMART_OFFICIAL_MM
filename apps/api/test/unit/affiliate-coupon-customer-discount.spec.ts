// Phase 158 — Affiliate Coupon Customer-Discount audit.
//
// Facade (validateAffiliateCouponForCustomer):
//   - PERCENT discount is capped by maxDiscountAmount (Critical #2 — an
//     uncapped % on a high-value order gave away unbounded money).
//   - FREE_SHIPPING surfaces valueType=FREE_SHIPPING with discountAmount 0
//     (#3 — the waiver is applied at checkout, not as a subtotal discount).
//   - startsAt gates a future-dated campaign code (#10).
//
// Service (updateCouponConfig):
//   - writes an AFFILIATE_COUPON_CONFIG_UPDATED audit row (#9 — config moves
//     customer-facing money and was previously unaudited);
//   - FREE_SHIPPING clears the stale value/cap;
//   - an incoherent start/expiry window is rejected.

import { AffiliatePublicFacade } from '../../src/modules/affiliate/application/facades/affiliate-public.facade';
import { AffiliateRegistrationService } from '../../src/modules/affiliate/application/services/affiliate-registration.service';
import { BadRequestAppException } from '../../src/core/exceptions';

// ── Facade ──────────────────────────────────────────────────────
function buildFacade(coupon: any) {
  const prisma = {
    affiliateCouponCode: {
      findUnique: jest.fn().mockResolvedValue(coupon),
    },
  } as any;
  const eventBus = { publish: jest.fn() } as any;
  const env = {} as any;
  const facade = new AffiliatePublicFacade(prisma, eventBus, env);
  (facade as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return facade;
}

function baseCoupon(over: Record<string, any> = {}) {
  return {
    id: 'c1',
    code: 'AFF10',
    discountId: null,
    isActive: true,
    startsAt: null,
    expiresAt: null,
    maxUses: null,
    usedCount: 0,
    perUserLimit: 1,
    minOrderValue: null,
    customerDiscountType: null,
    customerDiscountValue: null,
    maxDiscountAmount: null,
    affiliate: { id: 'a1', status: 'ACTIVE' },
    ...over,
  };
}

describe('AffiliatePublicFacade.validateAffiliateCouponForCustomer (Phase 158)', () => {
  it('caps a PERCENT discount by maxDiscountAmount', async () => {
    const facade = buildFacade(
      baseCoupon({
        customerDiscountType: 'PERCENT',
        customerDiscountValue: 20, // 20% of 2,00,000 = 40,000 …
        maxDiscountAmount: 500, // … but capped at 500.
      }),
    );
    const res = await facade.validateAffiliateCouponForCustomer({
      code: 'AFF10',
      subtotal: 200000,
    });
    expect(res?.valueType).toBe('PERCENT');
    expect(res?.discountAmount).toBe(500);
  });

  it('applies the full PERCENT discount when no cap is set', async () => {
    const facade = buildFacade(
      baseCoupon({ customerDiscountType: 'PERCENT', customerDiscountValue: 10 }),
    );
    const res = await facade.validateAffiliateCouponForCustomer({
      code: 'AFF10',
      subtotal: 1000,
    });
    expect(res?.discountAmount).toBe(100);
  });

  it('surfaces FREE_SHIPPING with a zero subtotal discount', async () => {
    const facade = buildFacade(
      baseCoupon({ customerDiscountType: 'FREE_SHIPPING', customerDiscountValue: null }),
    );
    const res = await facade.validateAffiliateCouponForCustomer({
      code: 'AFF10',
      subtotal: 1500,
    });
    expect(res?.valueType).toBe('FREE_SHIPPING');
    expect(res?.discountAmount).toBe(0);
  });

  it('rejects a code whose startsAt is still in the future', async () => {
    const facade = buildFacade(
      baseCoupon({ startsAt: new Date(Date.now() + 86_400_000) }),
    );
    await expect(
      facade.validateAffiliateCouponForCustomer({ code: 'AFF10', subtotal: 1000 }),
    ).rejects.toThrow(/not active yet/i);
  });
});

// ── Service ─────────────────────────────────────────────────────
function buildService(existing: any) {
  const update = jest.fn(async (args: any) => ({
    id: 'c1',
    code: 'AFF10',
    isPrimary: true,
    ...existing,
    ...args.data,
  }));
  const prisma = {
    affiliateCouponCode: {
      findUnique: jest.fn().mockResolvedValue(existing),
      update,
    },
  } as any;
  const eventBus = { publish: jest.fn() } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliateRegistrationService(prisma, eventBus, audit);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, update, audit };
}

function existingCoupon(over: Record<string, any> = {}) {
  return {
    id: 'c1',
    affiliateId: 'a1',
    isActive: true,
    customerDiscountType: null,
    customerDiscountValue: null,
    maxDiscountAmount: null,
    startsAt: null,
    expiresAt: null,
    maxUses: null,
    perUserLimit: 1,
    minOrderValue: null,
    ...over,
  };
}

describe('AffiliateRegistrationService.updateCouponConfig (Phase 158)', () => {
  it('writes an AFFILIATE_COUPON_CONFIG_UPDATED audit row', async () => {
    const { svc, audit } = buildService(existingCoupon());
    await svc.updateCouponConfig({
      affiliateId: 'a1',
      couponId: 'c1',
      customerDiscountType: 'PERCENT',
      customerDiscountValue: 10,
      maxDiscountAmount: 500,
      adminId: 'admin1',
      audit: { ipAddress: '1.2.3.4', userAgent: 'jest' },
    });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AFFILIATE_COUPON_CONFIG_UPDATED',
        actorId: 'admin1',
        resourceId: 'c1',
        ipAddress: '1.2.3.4',
      }),
    );
  });

  it('clears the value + cap when switched to FREE_SHIPPING', async () => {
    const { svc, update } = buildService(
      existingCoupon({ customerDiscountType: 'PERCENT', customerDiscountValue: 10, maxDiscountAmount: 500 }),
    );
    await svc.updateCouponConfig({
      affiliateId: 'a1',
      couponId: 'c1',
      customerDiscountType: 'FREE_SHIPPING',
      adminId: 'admin1',
    });
    const data = update.mock.calls[0]![0].data;
    expect(data.customerDiscountType).toBe('FREE_SHIPPING');
    expect(data.customerDiscountValue).toBeNull();
    expect(data.maxDiscountAmount).toBeNull();
  });

  it('rejects an incoherent activation window (startsAt ≥ expiresAt)', async () => {
    const { svc } = buildService(existingCoupon());
    await expect(
      svc.updateCouponConfig({
        affiliateId: 'a1',
        couponId: 'c1',
        startsAt: new Date('2026-07-01T00:00:00Z'),
        expiresAt: new Date('2026-06-01T00:00:00Z'),
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects a PERCENT discount over 100', async () => {
    const { svc } = buildService(existingCoupon());
    await expect(
      svc.updateCouponConfig({
        affiliateId: 'a1',
        couponId: 'c1',
        customerDiscountType: 'PERCENT',
        customerDiscountValue: 150,
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});
