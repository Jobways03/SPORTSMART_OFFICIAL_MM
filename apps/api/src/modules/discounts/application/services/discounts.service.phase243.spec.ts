// Phase 243-247 — execution-flow tests for the hardened admin discount
// lifecycle: validateCouponForCheckout guards (disabled states, PERCENT cap,
// BOGO MIN_AMOUNT self-overlap, maxUsesPerOrder), the edit-while-live freeze,
// optimistic-concurrency, the status FSM, abuse-suspend, and create-time
// collision / product-existence guards.
import { DiscountsService } from './discounts.service';

function makeService() {
  const repo: any = {
    findById: jest.fn(),
    findByCode: jest.fn().mockResolvedValue(null),
    findByCodeWithProducts: jest.fn(),
    createWithRelations: jest.fn(async (data: any) => ({ id: 'd1', ...data })),
    updateWithRelations: jest.fn(async (id: string, data: any) => ({ id, ...data })),
    update: jest.fn(async (id: string, data: any) => ({ id, ...data })),
    findExistingProductIds: jest.fn(),
    findExistingCollectionIds: jest.fn().mockResolvedValue([]),
  };
  const affiliate: any = {
    couponCodeExists: jest.fn().mockResolvedValue(false),
    affiliateExists: jest.fn().mockResolvedValue(true),
    validateAffiliateCouponForCustomer: jest.fn().mockResolvedValue(null),
  };
  const events: any = { emitDiscountCrud: jest.fn().mockResolvedValue(undefined) };
  const eligibility: any = {
    setRules: jest.fn().mockResolvedValue(undefined),
    check: jest.fn().mockResolvedValue({ allowed: true }),
  };
  const svc = new DiscountsService(repo, affiliate, events, eligibility);
  return { svc, repo, affiliate, events, eligibility };
}

const baseCoupon = (over: Record<string, any> = {}) => ({
  id: 'd1',
  code: 'SAVE',
  title: 'x',
  method: 'CODE',
  status: 'ACTIVE',
  startsAt: new Date(Date.now() - 86400000),
  endsAt: null,
  maxUses: null,
  usedCount: 0,
  minRequirement: 'NONE',
  minRequirementValue: null,
  type: 'AMOUNT_OFF_ORDER',
  valueType: 'PERCENTAGE',
  value: 50,
  maxDiscountAmountInPaise: null,
  products: [],
  buyType: null,
  buyValue: null,
  getQuantity: null,
  getItemsFrom: null,
  getDiscountType: null,
  getDiscountValue: null,
  ...over,
});

describe('DiscountsService — validateCouponForCheckout guards', () => {
  it.each(['PAUSED', 'ARCHIVED', 'SUSPENDED_FOR_ABUSE', 'DRAFT'])(
    'rejects a %s coupon as unavailable',
    async (status) => {
      const { svc, repo } = makeService();
      repo.findByCodeWithProducts.mockResolvedValue(baseCoupon({ status }));
      await expect(
        svc.validateCouponForCheckout('SAVE', 1000, []),
      ).rejects.toThrow(/no longer available/i);
    },
  );

  it('caps a PERCENTAGE discount at maxDiscountAmountInPaise', async () => {
    const { svc, repo } = makeService();
    // 50% of ₹1000 = ₹500, but capped at ₹300 (30000 paise).
    repo.findByCodeWithProducts.mockResolvedValue(
      baseCoupon({ value: 50, maxDiscountAmountInPaise: 30000n }),
    );
    const res = await svc.validateCouponForCheckout('SAVE', 1000, []);
    expect(res.discountAmount).toBe(300);
  });

  it('BOGO MIN_AMOUNT does not give the only purchased unit away free', async () => {
    const { svc, repo } = makeService();
    // 1 unit @ ₹2000; buy ₹1000 get 1 free; same product is buy+get.
    repo.findByCodeWithProducts.mockResolvedValue(
      baseCoupon({
        type: 'BUY_X_GET_Y',
        buyType: 'MIN_AMOUNT',
        buyValue: 1000,
        getQuantity: 1,
        getDiscountType: 'FREE',
        products: [
          { scope: 'BUY', productId: 'p1' },
          { scope: 'GET', productId: 'p1' },
        ],
      }),
    );
    await expect(
      svc.validateCouponForCheckout('SAVE', 2000, [
        { productId: 'p1', quantity: 1, unitPrice: 2000 },
      ]),
    ).rejects.toThrow(/free\/discounted item/i);
  });

  it('caps BOGO discounted units at maxUsesPerOrder', async () => {
    const { svc, repo } = makeService();
    // getQuantity 5 but maxUsesPerOrder 1 → only 1 unit discounted.
    repo.findByCodeWithProducts.mockResolvedValue(
      baseCoupon({
        type: 'BUY_X_GET_Y',
        buyType: 'MIN_QUANTITY',
        buyValue: 0,
        getQuantity: 5,
        maxUsesPerOrder: 1,
        getDiscountType: 'FREE',
        products: [],
      }),
    );
    const res = await svc.validateCouponForCheckout('SAVE', 3000, [
      { productId: 'p1', quantity: 3, unitPrice: 1000 },
    ]);
    // Only one ₹1000 unit free, not three.
    expect(res.discountAmount).toBe(1000);
  });
});

describe('DiscountsService — edit-while-live + OCC', () => {
  it('freezes money fields once the discount has redemptions', async () => {
    const { svc, repo } = makeService();
    repo.findById.mockResolvedValue(
      baseCoupon({ usedCount: 5, version: 1 }),
    );
    await expect(
      svc.update('d1', { value: 90 }),
    ).rejects.toThrow(/Cannot change/i);
    expect(repo.updateWithRelations).not.toHaveBeenCalled();
  });

  it('allows non-money edits on a live discount', async () => {
    const { svc, repo } = makeService();
    repo.findById.mockResolvedValue(baseCoupon({ usedCount: 5, version: 1 }));
    repo.findExistingProductIds.mockResolvedValue([]);
    await svc.update('d1', { title: 'New title' });
    expect(repo.updateWithRelations).toHaveBeenCalled();
  });

  it('rejects a stale optimistic-concurrency version', async () => {
    const { svc, repo } = makeService();
    repo.findById.mockResolvedValue(baseCoupon({ usedCount: 0, version: 3 }));
    await expect(
      svc.update('d1', { title: 'x', expectedVersion: 1 }),
    ).rejects.toThrow(/changed by someone else/i);
  });
});

describe('DiscountsService — status FSM + abuse suspend', () => {
  it('rejects an illegal transition (ARCHIVED is terminal)', async () => {
    const { svc, repo } = makeService();
    repo.findById.mockResolvedValue(baseCoupon({ status: 'ARCHIVED' }));
    await expect(svc.setStatus('d1', 'ACTIVE')).rejects.toThrow(
      /Cannot move discount/i,
    );
  });

  it('allows ACTIVE → PAUSED', async () => {
    const { svc, repo } = makeService();
    repo.findById.mockResolvedValue(baseCoupon({ status: 'ACTIVE' }));
    await svc.setStatus('d1', 'PAUSED', { actorId: 'a1' });
    expect(repo.update).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ status: 'PAUSED' }),
    );
  });

  it('suspendForAbuse sets SUSPENDED_FOR_ABUSE', async () => {
    const { svc, repo } = makeService();
    repo.findById.mockResolvedValue(baseCoupon({ status: 'ACTIVE' }));
    await svc.suspendForAbuse('d1', true, { actorId: 'risk1' }, 'leak');
    expect(repo.update).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ status: 'SUSPENDED_FOR_ABUSE' }),
    );
  });
});

describe('DiscountsService — create-time guards', () => {
  const createBody = (over: Record<string, any> = {}) => ({
    code: 'NEW',
    type: 'AMOUNT_OFF_ORDER',
    method: 'CODE',
    valueType: 'PERCENTAGE',
    value: 10,
    ...over,
  });

  it('rejects a code that collides with an affiliate coupon', async () => {
    const { svc, affiliate } = makeService();
    affiliate.couponCodeExists.mockResolvedValue(true);
    await expect(svc.create(createBody())).rejects.toThrow(
      /already in use by an affiliate coupon/i,
    );
  });

  it('rejects unknown product ids before any write', async () => {
    const { svc, repo } = makeService();
    repo.findExistingProductIds.mockResolvedValue([]); // none exist
    await expect(
      svc.create(createBody({ productIds: ['bad-id'] })),
    ).rejects.toThrow(/Unknown product id/i);
    expect(repo.createWithRelations).not.toHaveBeenCalled();
  });

  it('rejects SELLER-funded ALL_PRODUCTS (multi-seller cross-debit)', async () => {
    const { svc } = makeService();
    await expect(
      svc.create(createBody({ fundingType: 'SELLER', appliesTo: 'ALL_PRODUCTS' })),
    ).rejects.toThrow(/SELLER-funded discounts must target specific products/i);
  });

  it('persists the legacy eligibility scalar + actor on create', async () => {
    const { svc, repo } = makeService();
    repo.findExistingProductIds.mockResolvedValue([]);
    await svc.create(
      createBody({ eligibility: 'SPECIFIC_CUSTOMERS' }),
      { actorId: 'admin-9', actorRole: 'SUPER_ADMIN' },
    );
    expect(repo.createWithRelations).toHaveBeenCalledWith(
      expect.objectContaining({
        eligibility: 'SPECIFIC_CUSTOMERS',
        createdById: 'admin-9',
      }),
      expect.anything(),
    );
  });
});
