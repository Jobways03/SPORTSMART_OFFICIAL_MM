import 'reflect-metadata';
import { OrdersService } from '../../src/modules/orders/application/services/orders.service';
import { BadRequestAppException } from '../../src/core/exceptions';

// Phase 168 — COD Mark-Paid audit remediation coverage.
//   #1  COD-only guard (ONLINE order rejected)
//   #7  CAS flip (updateMany WHERE paymentStatus=PENDING; loser is a no-op)
//   #4  CashCollection ledger row written in the tx
//   #9  variance gate (collected != expected requires a reason)
//   #14 captured event carries amountInPaise
//   #5  audit row written
//   #15 orderStatus-mismatch opens a PaymentMismatchAlert (not swallowed)
//   #10 per-sub-order mark-paid + master recompute

type TxMock = {
  masterOrder: { updateMany: jest.Mock; update: jest.Mock };
  subOrder: { update: jest.Mock; updateMany: jest.Mock; findMany: jest.Mock };
  cashCollection: { create: jest.Mock };
};

function makeTx(
  masterFlipCount = 1,
  subFlipCount = 1,
  freshSiblings: any[] = [],
): TxMock {
  return {
    masterOrder: {
      updateMany: jest.fn().mockResolvedValue({ count: masterFlipCount }),
      update: jest.fn().mockResolvedValue({}),
    },
    subOrder: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: subFlipCount }),
      // Phase 168 review (L1) — master recompute re-reads siblings IN-TX.
      findMany: jest.fn().mockResolvedValue(freshSiblings),
    },
    cashCollection: { create: jest.fn().mockResolvedValue({ id: 'cc-1' }) },
  };
}

function makeService(opts: {
  order?: any;
  tx?: TxMock;
  masterFlipCount?: number;
} = {}) {
  const order = opts.order ?? {
    id: 'mo-1',
    orderNumber: 'ORD-1',
    customerId: 'cust-1',
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    orderStatus: 'DISPATCHED', // → DELIVERED allowed
    totalAmount: 5000,
    totalAmountInPaise: 500000n,
    subOrders: [
      { id: 'so-1', acceptStatus: 'ACCEPTED', fulfillmentStatus: 'DELIVERED', paymentStatus: 'PENDING' },
    ],
  };
  const tx = opts.tx ?? makeTx(opts.masterFlipCount ?? 1);
  const orderRepo: any = {
    findMasterOrderById: jest.fn().mockResolvedValue(order),
    findSubOrderByIdWithMasterOrder: jest.fn(),
    executeTransaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const env: any = { getNumber: (_: string, d: number) => d };
  const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const paymentOps: any = { flagMismatch: jest.fn().mockResolvedValue(undefined) };

  const svc = new OrdersService(
    orderRepo,            // orderRepo
    eventBus,             // eventBus
    {} as any,            // catalogFacade
    {} as any,            // franchiseFacade
    {} as any,            // prisma
    {} as any,            // stockRestore
    env,                  // env
    {} as any,            // taxFacade
    auditFacade,          // auditFacade?
    undefined,            // refundInstructions?
    undefined,            // timeline?
    undefined,            // shipmentEvidence?
    undefined,            // ewayBill?
    paymentOps,           // paymentOps?
  );
  return { svc, orderRepo, eventBus, env, auditFacade, paymentOps, tx, order };
}

describe('OrdersService.markAsPaid — Phase 168', () => {
  it('#1 rejects a non-COD (ONLINE) order', async () => {
    const { svc } = makeService({
      order: {
        id: 'mo-1', orderNumber: 'ORD-1', customerId: 'c1',
        paymentMethod: 'ONLINE', paymentStatus: 'PENDING', orderStatus: 'DISPATCHED',
        totalAmount: 5000, totalAmountInPaise: 500000n,
        subOrders: [{ id: 'so-1', acceptStatus: 'ACCEPTED', fulfillmentStatus: 'DELIVERED', paymentStatus: 'PENDING' }],
      },
    });
    await expect(svc.markAsPaid('mo-1', { actorId: 'admin-1' })).rejects.toThrow(BadRequestAppException);
  });

  it('#7/#4/#14 flips via CAS, writes a CashCollection row, emits amountInPaise', async () => {
    const { svc, tx, eventBus } = makeService();
    await svc.markAsPaid('mo-1', { actorId: 'admin-1' });

    // CAS guarded on PENDING
    expect(tx.masterOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mo-1', paymentStatus: 'PENDING' } }),
    );
    // ledger row
    expect(tx.cashCollection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          masterOrderId: 'mo-1',
          expectedAmountInPaise: 500000n,
          collectedAmountInPaise: 500000n,
          varianceInPaise: 0n,
        }),
      }),
    );
    // captured event with amountInPaise (BigInt-safe string) + COD source
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'payments.payment.captured',
        payload: expect.objectContaining({ amountInPaise: '500000', source: 'admin.markAsPaid' }),
      }),
      expect.objectContaining({ tx }),
    );
  });

  it('#5 writes an audit row (COD_MARK_PAID)', async () => {
    const { svc, auditFacade } = makeService();
    await svc.markAsPaid('mo-1', { actorId: 'admin-1', ipAddress: '1.2.3.4', userAgent: 'jest' });
    expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COD_MARK_PAID', resourceId: 'mo-1', actorId: 'admin-1' }),
    );
  });

  it('#9 rejects a cash variance with no reason, accepts one with a reason', async () => {
    const { svc } = makeService();
    await expect(
      svc.markAsPaid('mo-1', { actorId: 'a1', collectedAmountInPaise: 490000n }),
    ).rejects.toThrow(/varianceReason is required/);

    const ok = makeService();
    await ok.svc.markAsPaid('mo-1', {
      actorId: 'a1', collectedAmountInPaise: 490000n, varianceReason: 'short by ₹100',
    });
    expect(ok.tx.cashCollection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ collectedAmountInPaise: 490000n, varianceInPaise: -10000n, varianceReason: 'short by ₹100' }),
      }),
    );
  });

  it('#7 loser of the CAS race is a no-op throw (count=0)', async () => {
    const tx = makeTx(0); // masterOrder.updateMany returns count 0
    const { svc, eventBus } = makeService({ tx });
    await expect(svc.markAsPaid('mo-1', { actorId: 'a1' })).rejects.toThrow(/already marked as paid/);
    expect(tx.cashCollection.create).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('#15 opens a PaymentMismatchAlert when orderStatus cannot reach DELIVERED', async () => {
    const { svc, paymentOps } = makeService({
      order: {
        id: 'mo-1', orderNumber: 'ORD-1', customerId: 'c1',
        paymentMethod: 'COD', paymentStatus: 'PENDING',
        orderStatus: 'PLACED', // PLACED → DELIVERED is NOT allowed
        totalAmount: 5000, totalAmountInPaise: 500000n,
        subOrders: [{ id: 'so-1', acceptStatus: 'ACCEPTED', fulfillmentStatus: 'DELIVERED', paymentStatus: 'PENDING' }],
      },
    });
    await svc.markAsPaid('mo-1', { actorId: 'a1' });
    expect(paymentOps.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'DUPLICATE_PAYMENT', masterOrderId: 'mo-1', severity: 70 }),
    );
  });

  it('rejects when not all sub-orders are delivered', async () => {
    const { svc } = makeService({
      order: {
        id: 'mo-1', orderNumber: 'ORD-1', customerId: 'c1',
        paymentMethod: 'COD', paymentStatus: 'PENDING', orderStatus: 'DISPATCHED',
        totalAmount: 5000, totalAmountInPaise: 500000n,
        subOrders: [{ id: 'so-1', acceptStatus: 'ACCEPTED', fulfillmentStatus: 'SHIPPED', paymentStatus: 'PENDING' }],
      },
    });
    await expect(svc.markAsPaid('mo-1', { actorId: 'a1' })).rejects.toThrow(/must be DELIVERED/);
  });
});

describe('OrdersService.markSubOrderAsPaid — Phase 168 (#10)', () => {
  function makeSubService(opts: {
    sub?: any;
    siblings?: any[];
    masterStatus?: string;
    tx?: TxMock;
  } = {}) {
    const master = {
      id: 'mo-1', orderNumber: 'ORD-1', customerId: 'c1',
      paymentMethod: 'COD', paymentStatus: 'PENDING',
      orderStatus: opts.masterStatus ?? 'DISPATCHED',
      totalAmount: 8000, totalAmountInPaise: 800000n,
      subOrders: opts.siblings ?? [
        { id: 'so-1', acceptStatus: 'ACCEPTED', paymentStatus: 'PENDING' },
        { id: 'so-2', acceptStatus: 'ACCEPTED', paymentStatus: 'PAID' },
      ],
    };
    const sub = opts.sub ?? {
      id: 'so-1', acceptStatus: 'ACCEPTED', fulfillmentStatus: 'DELIVERED',
      paymentStatus: 'PENDING', subTotalInPaise: 300000n, masterOrder: master,
    };
    const tx = opts.tx ?? makeTx(1, 1);
    const orderRepo: any = {
      findMasterOrderById: jest.fn(),
      findSubOrderByIdWithMasterOrder: jest.fn().mockResolvedValue(sub),
      executeTransaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const env: any = { getNumber: (_: string, d: number) => d };
    const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const svc = new OrdersService(
      orderRepo, eventBus, {} as any, {} as any, {} as any, {} as any, env, {} as any,
      auditFacade, undefined, undefined, undefined, undefined, undefined,
    );
    return { svc, tx, eventBus, auditFacade };
  }

  it('flips the sub-order + master (all siblings paid) and fans out the captured event once', async () => {
    // In-tx re-read: so-1 just flipped PAID, so-2 already PAID → all active paid.
    const tx = makeTx(1, 1, [
      { id: 'so-1', acceptStatus: 'ACCEPTED', paymentStatus: 'PAID' },
      { id: 'so-2', acceptStatus: 'ACCEPTED', paymentStatus: 'PAID' },
    ]);
    const { svc, eventBus } = makeSubService({ tx });
    const res = await svc.markSubOrderAsPaid('so-1', { actorId: 'a1' });
    expect(res).toEqual({ subOrderPaid: true, masterPaid: true });
    expect(tx.subOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'so-1', paymentStatus: 'PENDING' } }),
    );
    expect(tx.cashCollection.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subOrderId: 'so-1', masterOrderId: 'mo-1' }) }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ source: 'admin.markSubOrderAsPaid' }) }),
      expect.objectContaining({ tx }),
    );
  });

  it('flips ONLY the sub-order when a sibling is still PENDING (master stays PENDING, no event)', async () => {
    // In-tx re-read: so-1 flipped PAID but so-2 still PENDING → master NOT flipped.
    const tx = makeTx(1, 1, [
      { id: 'so-1', acceptStatus: 'ACCEPTED', paymentStatus: 'PAID' },
      { id: 'so-2', acceptStatus: 'ACCEPTED', paymentStatus: 'PENDING' },
    ]);
    const { svc, eventBus } = makeSubService({ tx });
    const res = await svc.markSubOrderAsPaid('so-1', { actorId: 'a1' });
    expect(res).toEqual({ subOrderPaid: true, masterPaid: false });
    expect(tx.masterOrder.updateMany).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('rejects a non-delivered sub-order', async () => {
    const { svc } = makeSubService({
      sub: {
        id: 'so-1', acceptStatus: 'ACCEPTED', fulfillmentStatus: 'SHIPPED',
        paymentStatus: 'PENDING', subTotalInPaise: 300000n,
        masterOrder: { id: 'mo-1', paymentMethod: 'COD', subOrders: [] },
      },
    });
    await expect(svc.markSubOrderAsPaid('so-1', { actorId: 'a1' })).rejects.toThrow(/DELIVERED/);
  });
});
