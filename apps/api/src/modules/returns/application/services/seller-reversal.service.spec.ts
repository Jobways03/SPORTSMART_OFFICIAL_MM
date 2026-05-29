// Phase 108 (2026-05-25) — SellerReversalService unit coverage.
//
// Verifies the request validations, the PENDING_APPROVAL → * CAS guards, and
// that approval applies every effect atomically (stock + ledger + commission
// reversal tagged SELLER_REVERSAL + SellerDebit + reversedQuantity) while
// leaving the sub-order's customer-facing fulfillmentStatus untouched.

import { SellerReversalService } from './seller-reversal.service';

function buildDb(overrides: Record<string, any> = {}) {
  const db: any = {
    subOrder: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    sellerReversal: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'rev1', items: [] }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    sellerProductMapping: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', stockQty: 10, settlementPrice: 800 }),
      update: jest.fn().mockResolvedValue({}),
    },
    productVariant: { update: jest.fn().mockResolvedValue({}) },
    product: { update: jest.fn().mockResolvedValue({}) },
    stockMovement: { create: jest.fn().mockResolvedValue({}) },
    orderItem: { update: jest.fn().mockResolvedValue({}) },
    sellerDebit: { create: jest.fn().mockResolvedValue({ id: 'debit-1' }) },
  };
  db.$transaction = jest.fn(async (arg: any) =>
    typeof arg === 'function' ? arg(db) : Promise.all(arg),
  );
  Object.assign(db, overrides);
  return db;
}

function buildService(db: any) {
  const commissionReversal = { reverseCommissionForReturn: jest.fn().mockResolvedValue(0) };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new SellerReversalService(
    db as any,
    commissionReversal as any,
    audit as any,
    logger as any,
  );
  return { service, commissionReversal, audit };
}

const deliveredSubOrder = (over: Record<string, any> = {}) => ({
  id: 'so1',
  fulfillmentNodeType: 'SELLER',
  sellerId: 'seller-a',
  masterOrderId: 'mo1',
  fulfillmentStatus: 'DELIVERED',
  returnWindowEndsAt: new Date(Date.now() + 86_400_000),
  items: [
    { id: 'oi1', quantity: 3, reversedQuantity: 0, productId: 'p1', variantId: 'v1', unitPriceInPaise: 100000n, unitPrice: 1000 },
  ],
  ...over,
});

describe('SellerReversalService.request', () => {
  it('creates a PENDING_APPROVAL reversal with the snapshotted value + mirrors sub-order status', async () => {
    const db = buildDb();
    db.subOrder.findUnique.mockResolvedValue(deliveredSubOrder());
    const { service, audit } = buildService(db);

    await service.request({
      sellerId: 'seller-a',
      subOrderId: 'so1',
      reason: 'Returned via B2B channel',
      items: [{ orderItemId: 'oi1', quantity: 2 }],
    });

    expect(db.sellerReversal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_APPROVAL',
          reversalValueInPaise: 200000n, // 100000 paise × 2
          subOrderId: 'so1',
          sellerId: 'seller-a',
        }),
      }),
    );
    expect(db.subOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sellerReversalStatus: 'PENDING_APPROVAL' } }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seller.reversal.requested', actorRole: 'SELLER' }),
    );
  });

  it('rejects a non-DELIVERED sub-order', async () => {
    const db = buildDb();
    db.subOrder.findUnique.mockResolvedValue(deliveredSubOrder({ fulfillmentStatus: 'SHIPPED' }));
    const { service } = buildService(db);
    await expect(
      service.request({ sellerId: 'seller-a', subOrderId: 'so1', reason: 'x reason', items: [{ orderItemId: 'oi1', quantity: 1 }] }),
    ).rejects.toThrow(/delivered/i);
  });

  it('rejects when the return window has expired', async () => {
    const db = buildDb();
    db.subOrder.findUnique.mockResolvedValue(deliveredSubOrder({ returnWindowEndsAt: new Date(Date.now() - 1000) }));
    const { service } = buildService(db);
    await expect(
      service.request({ sellerId: 'seller-a', subOrderId: 'so1', reason: 'x reason', items: [{ orderItemId: 'oi1', quantity: 1 }] }),
    ).rejects.toThrow(/window/i);
  });

  it('rejects over-reversal beyond remaining quantity', async () => {
    const db = buildDb();
    db.subOrder.findUnique.mockResolvedValue(
      deliveredSubOrder({ items: [{ id: 'oi1', quantity: 3, reversedQuantity: 2, productId: 'p1', variantId: 'v1', unitPriceInPaise: 100000n, unitPrice: 1000 }] }),
    );
    const { service } = buildService(db);
    await expect(
      service.request({ sellerId: 'seller-a', subOrderId: 'so1', reason: 'x reason', items: [{ orderItemId: 'oi1', quantity: 2 }] }),
    ).rejects.toThrow(/only 1 remain/i);
  });

  it('returns NotFound for a sub-order owned by another seller', async () => {
    const db = buildDb();
    db.subOrder.findUnique.mockResolvedValue(deliveredSubOrder({ sellerId: 'someone-else' }));
    const { service } = buildService(db);
    await expect(
      service.request({ sellerId: 'seller-a', subOrderId: 'so1', reason: 'x reason', items: [{ orderItemId: 'oi1', quantity: 1 }] }),
    ).rejects.toThrow(/not found/i);
  });

  it('is idempotent — a prior reversal with the same key wins', async () => {
    const db = buildDb();
    db.subOrder.findUnique.mockResolvedValue(deliveredSubOrder());
    db.sellerReversal.findUnique.mockResolvedValue({ id: 'rev-existing', items: [] });
    const { service } = buildService(db);
    const out = await service.request({
      sellerId: 'seller-a', subOrderId: 'so1', reason: 'x reason',
      items: [{ orderItemId: 'oi1', quantity: 1 }], idempotencyKey: 'key-1',
    });
    expect(out).toEqual({ id: 'rev-existing', items: [] });
    expect(db.sellerReversal.create).not.toHaveBeenCalled();
  });
});

describe('SellerReversalService.approve', () => {
  const pendingReversal = {
    id: 'rev1', sellerId: 'seller-a', subOrderId: 'so1', masterOrderId: 'mo1',
    items: [{ orderItemId: 'oi1', productId: 'p1', variantId: 'v1', quantity: 2, unitPriceInPaise: 100000n }],
  };
  const subOrderForApprove = {
    id: 'so1',
    items: [{ id: 'oi1', unitPrice: 1000, quantity: 3, productId: 'p1', variantId: 'v1' }],
  };

  it('applies stock + ledger + commission reversal + SellerDebit + reversedQuantity, keeping fulfillmentStatus untouched', async () => {
    const db = buildDb();
    db.sellerReversal.updateMany.mockResolvedValue({ count: 1 });
    db.sellerReversal.findUniqueOrThrow.mockResolvedValue(pendingReversal);
    db.subOrder.findUniqueOrThrow.mockResolvedValue(subOrderForApprove);
    const { service, commissionReversal } = buildService(db);

    const res = await service.approve({ reversalId: 'rev1', adminId: 'admin-1', adminRole: 'SELLER_OPERATIONS' });

    expect(res).toEqual({ reversalId: 'rev1', status: 'APPROVED' });
    // stock restored to mapping + variant
    expect(db.sellerProductMapping.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stockQty: { increment: 2 } } }),
    );
    expect(db.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v1' }, data: { stock: { increment: 2 } } }),
    );
    // ledger row
    expect(db.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'RESTOCKED', quantityDelta: 2, referenceType: 'SELLER_REVERSAL' }) }),
    );
    // over-reversal guard
    expect(db.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'oi1' }, data: { reversedQuantity: { increment: 2 } } }),
    );
    // commission reversal tagged SELLER_REVERSAL, run inside the tx
    expect(commissionReversal.reverseCommissionForReturn).toHaveBeenCalledWith(
      expect.objectContaining({ subOrder: expect.objectContaining({ fulfillmentNodeType: 'SELLER' }) }),
      db,
      expect.objectContaining({ source: 'SELLER_REVERSAL', actorId: 'admin-1' }),
    );
    // SellerDebit: settlementPrice 800 × 2 × 100 = 160000 paise
    expect(db.sellerDebit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourceType: 'SELLER_REVERSAL', amountInPaise: 160000n }) }),
    );
    // sub-order mirror flips to APPROVED; fulfillmentStatus is never written
    expect(db.subOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sellerReversalStatus: 'APPROVED' } }),
    );
    const wroteFulfillment = db.subOrder.update.mock.calls.some(
      ([arg]: any[]) => arg?.data && 'fulfillmentStatus' in arg.data,
    );
    expect(wroteFulfillment).toBe(false);
  });

  it('rejects approval when the reversal is not PENDING_APPROVAL (CAS)', async () => {
    const db = buildDb();
    db.sellerReversal.updateMany.mockResolvedValue({ count: 0 });
    const { service } = buildService(db);
    await expect(service.approve({ reversalId: 'rev1', adminId: 'admin-1' })).rejects.toThrow(/pending approval/i);
    expect(db.sellerProductMapping.update).not.toHaveBeenCalled();
  });

  it('fails (no silent stock loss) when the seller mapping is missing', async () => {
    const db = buildDb();
    db.sellerReversal.updateMany.mockResolvedValue({ count: 1 });
    db.sellerReversal.findUniqueOrThrow.mockResolvedValue(pendingReversal);
    db.subOrder.findUniqueOrThrow.mockResolvedValue(subOrderForApprove);
    db.sellerProductMapping.findFirst.mockResolvedValue(null);
    const { service } = buildService(db);
    await expect(service.approve({ reversalId: 'rev1', adminId: 'admin-1' })).rejects.toThrow(/no seller mapping/i);
    expect(db.sellerDebit.create).not.toHaveBeenCalled();
  });
});

describe('SellerReversalService.reject / cancel', () => {
  it('reject flips REJECTED only from PENDING (CAS) and mirrors the sub-order', async () => {
    const db = buildDb();
    db.sellerReversal.updateMany.mockResolvedValue({ count: 1 });
    db.sellerReversal.findUniqueOrThrow.mockResolvedValue({ subOrderId: 'so1' });
    const { service } = buildService(db);
    const res = await service.reject({ reversalId: 'rev1', adminId: 'admin-1', rejectionReason: 'insufficient evidence' });
    expect(res.status).toBe('REJECTED');
    expect(db.subOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: { sellerReversalStatus: 'REJECTED' } }));
  });

  it('reject errors when not pending', async () => {
    const db = buildDb();
    db.sellerReversal.updateMany.mockResolvedValue({ count: 0 });
    const { service } = buildService(db);
    await expect(service.reject({ reversalId: 'rev1', adminId: 'admin-1', rejectionReason: 'too late now' })).rejects.toThrow(/pending approval/i);
  });

  it('cancel succeeds only for the owning seller while pending', async () => {
    const db = buildDb();
    db.sellerReversal.updateMany.mockResolvedValue({ count: 1 });
    db.sellerReversal.findUniqueOrThrow.mockResolvedValue({ subOrderId: 'so1' });
    const { service } = buildService(db);
    const res = await service.cancel({ reversalId: 'rev1', sellerId: 'seller-a' });
    expect(res.status).toBe('CANCELLED');
    expect(db.sellerReversal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sellerId: 'seller-a', status: 'PENDING_APPROVAL' }) }),
    );
  });

  it('cancel errors when not cancellable', async () => {
    const db = buildDb();
    db.sellerReversal.updateMany.mockResolvedValue({ count: 0 });
    const { service } = buildService(db);
    await expect(service.cancel({ reversalId: 'rev1', sellerId: 'seller-a' })).rejects.toThrow(/cannot be cancelled/i);
  });
});
