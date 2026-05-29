// Phase 159b — Affiliate Additional Coupon Code generation.
//
// The create-additional-coupon flow did not exist before (every affiliate had
// only the primary code minted on approval). These cover the new service:
//   - auto-generate vs admin-supplied (uppercased) code;
//   - duplicate / malformed code handling;
//   - ACTIVE-only + per-affiliate cap guards;
//   - isPrimary demotes the current primary in the same transaction;
//   - FREE_SHIPPING / range validation;
//   - audit + event on success;
//   - auto-gen collision → regenerate + retry.

import { AffiliateRegistrationService } from '../../src/modules/affiliate/application/services/affiliate-registration.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

function buildService(opts: {
  affiliate?: { id: string; status: string } | null;
  cap?: number;
  existingCount?: number;
} = {}) {
  const affiliate =
    opts.affiliate === undefined ? { id: 'a1', status: 'ACTIVE' } : opts.affiliate;
  const create = jest.fn(async (args: any) => ({ id: 'c1', ...args.data }));
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = { affiliateCouponCode: { create, updateMany } };
  const prisma = {
    affiliate: { findUnique: jest.fn().mockResolvedValue(affiliate) },
    affiliateSettings: {
      findUnique: jest.fn().mockResolvedValue({ maxCodesPerAffiliate: opts.cap ?? 10 }),
    },
    affiliateCouponCode: { count: jest.fn().mockResolvedValue(opts.existingCount ?? 0) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliateRegistrationService(prisma, eventBus, audit);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, create, updateMany, audit, eventBus };
}

const P2002 = { code: 'P2002', meta: { target: ['code'] } };

describe('AffiliateRegistrationService.createAdditionalCoupon (Phase 159b)', () => {
  it('auto-generates an AF-prefixed code as ADMIN_MANUAL, non-primary, with creator + audit + event', async () => {
    const { svc, create, audit, eventBus } = buildService();
    const res: any = await svc.createAdditionalCoupon({ affiliateId: 'a1', adminId: 'admin1' });
    const data = create.mock.calls[0]![0].data;
    expect(data.code).toMatch(/^AF[A-Z0-9]{7}$/);
    expect(data.couponSource).toBe('ADMIN_MANUAL');
    expect(data.isPrimary).toBe(false);
    expect(data.createdByAdminId).toBe('admin1');
    expect(res.code).toMatch(/^AF[A-Z0-9]{7}$/);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AFFILIATE_COUPON_CREATED' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'affiliate.coupon_created' }),
    );
  });

  it('stores an admin-supplied code uppercased', async () => {
    const { svc, create } = buildService();
    await svc.createAdditionalCoupon({ affiliateId: 'a1', code: 'diwali10', adminId: 'admin1' });
    expect(create.mock.calls[0]![0].data.code).toBe('DIWALI10');
  });

  it('rejects a malformed manual code (400) before any write', async () => {
    const { svc, create } = buildService();
    await expect(
      svc.createAdditionalCoupon({ affiliateId: 'a1', code: 'ab', adminId: 'admin1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a duplicate manual code (P2002) to Conflict', async () => {
    const { svc, create } = buildService();
    create.mockRejectedValueOnce(P2002);
    await expect(
      svc.createAdditionalCoupon({ affiliateId: 'a1', code: 'TAKEN1', adminId: 'admin1' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(create).toHaveBeenCalledTimes(1); // manual codes are NOT regenerated
  });

  it('regenerates and retries when an auto-generated code collides', async () => {
    const { svc, create } = buildService();
    create.mockRejectedValueOnce(P2002); // first candidate collides
    const res: any = await svc.createAdditionalCoupon({ affiliateId: 'a1', adminId: 'admin1' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(res.code).toMatch(/^AF[A-Z0-9]{7}$/);
  });

  it('rejects creation for a non-ACTIVE affiliate (400)', async () => {
    const { svc, create } = buildService({ affiliate: { id: 'a1', status: 'SUSPENDED' } });
    await expect(
      svc.createAdditionalCoupon({ affiliateId: 'a1', adminId: 'admin1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws NotFound for a missing affiliate', async () => {
    const { svc } = buildService({ affiliate: null });
    await expect(
      svc.createAdditionalCoupon({ affiliateId: 'nope', adminId: 'admin1' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('enforces the per-affiliate cap (400)', async () => {
    const { svc, create } = buildService({ cap: 10, existingCount: 10 });
    await expect(
      svc.createAdditionalCoupon({ affiliateId: 'a1', adminId: 'admin1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(create).not.toHaveBeenCalled();
  });

  it('demotes the current primary when isPrimary=true', async () => {
    const { svc, create, updateMany } = buildService();
    await svc.createAdditionalCoupon({ affiliateId: 'a1', isPrimary: true, adminId: 'admin1' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { affiliateId: 'a1', isPrimary: true },
        data: { isPrimary: false },
      }),
    );
    expect(create.mock.calls[0]![0].data.isPrimary).toBe(true);
  });

  it('FREE_SHIPPING clears any value + cap', async () => {
    const { svc, create } = buildService();
    await svc.createAdditionalCoupon({
      affiliateId: 'a1',
      customerDiscountType: 'FREE_SHIPPING',
      customerDiscountValue: 50,
      maxDiscountAmount: 100,
      adminId: 'admin1',
    });
    const data = create.mock.calls[0]![0].data;
    expect(data.customerDiscountType).toBe('FREE_SHIPPING');
    expect(data.customerDiscountValue).toBeNull();
    expect(data.maxDiscountAmount).toBeNull();
  });

  it('rejects a PERCENT discount over 100 (400)', async () => {
    const { svc, create } = buildService();
    await expect(
      svc.createAdditionalCoupon({
        affiliateId: 'a1',
        customerDiscountType: 'PERCENT',
        customerDiscountValue: 150,
        adminId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(create).not.toHaveBeenCalled();
  });
});
