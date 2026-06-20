// Option B (Phase 3) — DeferredOrderService unit specs.
//
// Two pure-logic regression guards that protect the deferred-order money path:
//   1. The cartSnapshot BigInt round-trip (toJsonSafe → DB Json → reviveJson).
//      placeOrderTransaction's input nests paise BigInts; if the encode/decode
//      ever drops or corrupts one, materialize() replays a WRONG order. We
//      simulate the DB by JSON-serializing the stored snapshot (Prisma Json
//      columns are JSON, so this is faithful).
//   2. The claimForMaterialization CAS query shape. The exactly-once guarantee
//      is the atomic `updateMany WHERE status='CREATED'`; if the status filter
//      is ever removed, two concurrent callers could both "win" and
//      double-charge. This locks the query shape so that regression fails loud.

import { DeferredOrderService } from './deferred-order.service';

function makeService(over: { updateManyCount?: number } = {}) {
  const create = jest.fn().mockResolvedValue({ id: 'sess-1' });
  const update = jest.fn().mockResolvedValue({});
  const updateMany = jest
    .fn()
    .mockResolvedValue({ count: over.updateManyCount ?? 1 });
  const prisma: any = {
    checkoutSession: { create, update, updateMany },
  };
  const env: any = {
    getBoolean: (_k: string, fallback: boolean) => fallback,
  };
  const repo: any = {};
  const service = new DeferredOrderService(prisma, env, repo);
  return { service, create, update, updateMany };
}

/** A placeOrderTransaction input nesting paise BigInts (the round-trip risk):
 *  shippingFeeInPaise at the top level and a deep BigInt inside addressSnapshot
 *  (a Record<string, any>) to prove the recursive traversal preserves both. */
function makePlaceInput() {
  return {
    customerId: 'cust-1',
    paymentMethod: 'ONLINE',
    addressSnapshot: { line1: '1 Test St', city: 'Pune', deepBig: BigInt(777) },
    itemCount: 2,
    totalAmount: 1499.5,
    discountCode: 'SAVE10',
    discountAmount: 50,
    shippingFeeInPaise: BigInt(4000),
    fulfillmentGroups: {
      'seller-1': {
        nodeName: 'Seller One',
        nodeType: 'SELLER',
        nodeId: 'seller-1',
        items: [
          {
            productId: 'p-1',
            variantId: null,
            productTitle: 'P1',
            variantTitle: null,
            sku: null,
            masterSku: null,
            imageUrl: null,
            unitPrice: 999.5,
            quantity: 1,
            totalPrice: 999.5,
          },
        ],
      },
    },
  } as any;
}

describe('DeferredOrderService — snapshot round-trip', () => {
  it('preserves nested paise BigInts and the materialize extras through encode→DB-Json→decode', async () => {
    const { service, create } = makeService();
    const placeInput = makePlaceInput();
    const reservationLinks = [
      {
        productId: 'p-1',
        variantId: null,
        quantity: 1,
        reservationId: 'res-1',
        allocatedNodeType: 'FRANCHISE',
        allocatedSellerId: 'seller-1',
      },
    ];

    await service.createSession({
      placeInput,
      walletApplyInPaise: BigInt(20000),
      gatewayAmountInPaise: BigInt(129950),
      addressId: 'addr-1',
      windowMinutes: 30,
      reservationLinks,
      discountId: 'disc-1',
      allocationEnabled: true,
      discountReservationId: 'redeem-1',
    });

    // Pull the snapshot createSession persisted, then simulate the DB Json
    // round-trip (Prisma stores/returns JSON, so this is faithful).
    const storedSnapshot = create.mock.calls[0][0].data.cartSnapshot;
    const session: any = {
      cartSnapshot: JSON.parse(JSON.stringify(storedSnapshot)),
      // The BigInt column is the authoritative wallet figure.
      walletApplyInPaise: BigInt(20000),
    };

    const decoded = service.decodeSnapshot(session);

    // BigInts survive exactly (the core round-trip risk) — top-level + deeply
    // nested inside addressSnapshot prove the recursive revive works.
    expect(decoded.placeInput.shippingFeeInPaise).toBe(BigInt(4000));
    expect((decoded.placeInput.addressSnapshot as any).deepBig).toBe(
      BigInt(777),
    );
    // Plain fields survive.
    expect(decoded.placeInput.customerId).toBe('cust-1');
    expect(decoded.placeInput.totalAmount).toBe(1499.5);
    // Materialize extras survive.
    expect(decoded.reservationLinks).toEqual(reservationLinks);
    expect(decoded.discountId).toBe('disc-1');
    expect(decoded.allocationEnabled).toBe(true);
    expect(decoded.discountReservationId).toBe('redeem-1');
    // walletDebitInPaise comes from the pristine BigInt column, not the snapshot.
    expect(decoded.walletDebitInPaise).toBe(20000);
  });

  it('defaults the materialize extras when an older snapshot lacks them', () => {
    const { service } = makeService();
    const session: any = {
      cartSnapshot: { placeInput: { customerId: 'c' } },
      walletApplyInPaise: BigInt(0),
    };
    const decoded = service.decodeSnapshot(session);
    expect(decoded.reservationLinks).toEqual([]);
    expect(decoded.discountId).toBeNull();
    expect(decoded.allocationEnabled).toBe(false);
    expect(decoded.discountReservationId).toBeNull();
    expect(decoded.walletDebitInPaise).toBe(0);
  });
});

describe('DeferredOrderService — claimForMaterialization (exactly-once CAS)', () => {
  it('claims atomically on status=CREATED→PAID and reports claimed=true', async () => {
    const { service, updateMany } = makeService({ updateManyCount: 1 });
    const res = await service.claimForMaterialization('sess-1', 'pay_123');
    expect(res).toEqual({ claimed: true });
    // The exactly-once guard: the WHERE *must* gate on status:'CREATED'.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: 'CREATED' },
      data: { status: 'PAID', razorpayPaymentId: 'pay_123' },
    });
  });

  it('reports claimed=false when another caller already won (count=0)', async () => {
    const { service } = makeService({ updateManyCount: 0 });
    const res = await service.claimForMaterialization('sess-1', 'pay_123');
    expect(res).toEqual({ claimed: false });
  });
});

describe('DeferredOrderService — markOrderCreated / markFailed', () => {
  it('links the order PAID→ORDER_CREATED, CAS-guarded on status=PAID', async () => {
    const { service, updateMany } = makeService({ updateManyCount: 1 });
    const res = await service.markOrderCreated('sess-1', 'mo-1');
    expect(res).toEqual({ claimed: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: 'PAID' },
      data: expect.objectContaining({
        status: 'ORDER_CREATED',
        masterOrderId: 'mo-1',
        orderCreatedAt: expect.any(Date),
      }),
    });
  });

  it('markOrderCreated reports claimed=false when the session is no longer PAID', async () => {
    const { service } = makeService({ updateManyCount: 0 });
    expect(await service.markOrderCreated('sess-1', 'mo-1')).toEqual({
      claimed: false,
    });
  });

  it('marks FAILED with a 500-char-capped reason', async () => {
    const { service, update } = makeService();
    await service.markFailed('sess-1', 'x'.repeat(900));
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('FAILED');
    expect(data.failureReason).toHaveLength(500);
  });

  it('never throws out of the failure path (best-effort)', async () => {
    const { service, update } = makeService();
    update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.markFailed('sess-1', 'boom')).resolves.toBeUndefined();
  });
});

describe('DeferredOrderService — Phase 5 reconciler transitions', () => {
  it('markExpired CAS-guards on status=CREATED', async () => {
    const { service, updateMany } = makeService({ updateManyCount: 1 });
    expect(await service.markExpired('sess-1')).toEqual({ claimed: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: 'CREATED' },
      data: { status: 'EXPIRED' },
    });
  });

  it('markRefunded CAS-guards on status=FAILED + refundedAt null', async () => {
    const { service, updateMany } = makeService({ updateManyCount: 1 });
    const res = await service.markRefunded('sess-1', 'rfnd_1');
    expect(res).toEqual({ claimed: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: 'FAILED', refundedAt: null },
      data: { refundedAt: expect.any(Date), refundReference: 'rfnd_1' },
    });
  });

  it('failStuckPaid CAS-guards on status=PAID + masterOrderId null (no clobber of a completed materialize)', async () => {
    const { service, updateMany } = makeService({ updateManyCount: 0 });
    const res = await service.failStuckPaid('sess-1', 'crashed');
    expect(res).toEqual({ claimed: false });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-1', status: 'PAID', masterOrderId: null },
      data: { status: 'FAILED', failureReason: 'crashed' },
    });
  });
});
