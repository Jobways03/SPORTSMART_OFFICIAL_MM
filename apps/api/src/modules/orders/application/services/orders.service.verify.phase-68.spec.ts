// Phase 68 (2026-05-22) — verifyOrder hardening regression.
//
// Covers:
//   Gap #7  — single-transaction wrap of FSM flip + sub-order
//             deadlines + final status (no partial commit on
//             allocation failure)
//   Gap #11 — ORDER_VERIFIED audit row written via AuditPublicFacade
//   Gap #12 — accept_deadline_at writes happen inside the same tx
//   Gap #23 — VOIDED paymentStatus rejected with a clear message
//   Gap #4/#5 — cross-path claim guard rejects direct-verify when
//               another admin holds the queue claim

import { OrdersService } from './orders.service';

function makeService(opts: {
  order?: any;
  allocations?: Array<{ serviceable: boolean }>;
}) {
  const order = opts.order ?? {
    id: 'mo-1',
    orderNumber: 'SM20260042',
    customerId: 'c-1',
    orderStatus: 'PLACED',
    paymentStatus: 'PAID',
    shippingAddressSnapshot: { postalCode: '500001' },
    subOrders: [
      { id: 'so-1', items: [{ productId: 'p-1', variantId: null, quantity: 1 }] },
      { id: 'so-2', items: [{ productId: 'p-2', variantId: null, quantity: 2 }] },
    ],
    verificationRiskBand: 'GREEN',
    verificationRiskScore: 10,
    claimedByAdminId: null,
    claimExpiresAt: null,
  };

  const findMasterOrderById = jest.fn().mockResolvedValue(order);
  const updateMasterOrder = jest.fn().mockResolvedValue({});
  const updateSubOrder = jest.fn().mockResolvedValue({});
  const orderRepo: any = {
    findMasterOrderById,
    updateMasterOrder,
    updateSubOrder,
  };

  const txMasterOrderUpdate = jest.fn().mockResolvedValue({});
  const txSubOrderUpdate = jest.fn().mockResolvedValue({});
  const prisma: any = {
    $transaction: jest.fn(async (cb: any) =>
      cb({
        masterOrder: { update: txMasterOrderUpdate },
        subOrder: { update: txSubOrderUpdate },
        // Phase 74 — verifyOrder now writes OrderVerificationDecision
        // row inside the tx (Phase 73 audit Gap #3/#18).
        orderVerificationDecision: { create: jest.fn().mockResolvedValue({}) },
      }),
    ),
    masterOrder: { findUnique: jest.fn().mockResolvedValue({}) },
  };

  let allocCallIdx = 0;
  const catalogFacade: any = {
    allocate: jest.fn(async () => {
      const alloc = opts.allocations
        ? opts.allocations[Math.min(allocCallIdx++, opts.allocations.length - 1)]
        : { serviceable: true };
      return {
        serviceable: alloc?.serviceable ?? true,
        primary: alloc?.serviceable ? { mappingId: 'm-1' } : null,
      };
    }),
  };

  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const stockRestore: any = {};
  const env: any = { getNumber: () => 14 };
  const taxFacade: any = {};
  const auditFacade: any = {
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
  const franchiseFacade: any = {};

  const svc = new OrdersService(
    orderRepo,
    eventBus,
    catalogFacade,
    franchiseFacade,
    prisma,
    stockRestore,
    env,
    taxFacade,
    auditFacade,
  );
  // OrdersService.getOrder is called at the end of verifyOrder;
  // stub it so we don't have to mock the read-side projection.
  (svc as any).getOrder = jest.fn().mockResolvedValue({ id: order.id });

  return {
    svc,
    findMasterOrderById,
    txMasterOrderUpdate,
    txSubOrderUpdate,
    prisma,
    auditFacade,
    catalogFacade,
    eventBus,
  };
}

describe('OrdersService.verifyOrder (Phase 68)', () => {
  it('Gap #23 — rejects VOIDED paymentStatus with a clear message', async () => {
    const { svc } = makeService({
      order: {
        id: 'mo-v',
        orderNumber: 'SM-V',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'VOIDED',
        shippingAddressSnapshot: { postalCode: '500001' },
        subOrders: [],
        verificationRiskBand: null,
      },
    });
    await expect(svc.verifyOrder('mo-v', 'admin-1')).rejects.toMatchObject({
      message: expect.stringContaining('voided'),
    });
  });

  it('Gap #23 — still rejects CANCELLED paymentStatus', async () => {
    const { svc } = makeService({
      order: {
        id: 'mo-c',
        orderNumber: 'SM-C',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'CANCELLED',
        shippingAddressSnapshot: { postalCode: '500001' },
        subOrders: [],
        verificationRiskBand: null,
      },
    });
    await expect(svc.verifyOrder('mo-c', 'admin-1')).rejects.toMatchObject({
      message: expect.stringContaining('cancelled'),
    });
  });

  it('Gap #4/#5 — direct verify is blocked when another admin holds a live claim', async () => {
    const { svc } = makeService({
      order: {
        id: 'mo-claim',
        orderNumber: 'SM-X',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        shippingAddressSnapshot: { postalCode: '500001' },
        subOrders: [{ id: 'so-1', items: [{ productId: 'p-1', variantId: null, quantity: 1 }] }],
        verificationRiskBand: 'GREEN',
        claimedByAdminId: 'admin-B',
        claimExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    await expect(svc.verifyOrder('mo-claim', 'admin-A')).rejects.toMatchObject({
      message: expect.stringContaining('held by another verifier'),
    });
  });

  it('Gap #4/#5 — claim held by the SAME admin allows the verify to proceed', async () => {
    const { svc, txMasterOrderUpdate } = makeService({
      order: {
        id: 'mo-self',
        orderNumber: 'SM-Y',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        shippingAddressSnapshot: { postalCode: '500001' },
        subOrders: [{ id: 'so-1', items: [{ productId: 'p-1', variantId: null, quantity: 1 }] }],
        verificationRiskBand: 'GREEN',
        claimedByAdminId: 'admin-A',
        claimExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    await svc.verifyOrder('mo-self', 'admin-A');
    expect(txMasterOrderUpdate).toHaveBeenCalled();
  });

  it('Gap #4/#5 — expired foreign claim is treated as no claim', async () => {
    const { svc, txMasterOrderUpdate } = makeService({
      order: {
        id: 'mo-expired',
        orderNumber: 'SM-Z',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        shippingAddressSnapshot: { postalCode: '500001' },
        subOrders: [{ id: 'so-1', items: [{ productId: 'p-1', variantId: null, quantity: 1 }] }],
        verificationRiskBand: 'YELLOW',
        claimedByAdminId: 'admin-B',
        claimExpiresAt: new Date(Date.now() - 60 * 1000),
      },
    });
    await svc.verifyOrder('mo-expired', 'admin-A');
    expect(txMasterOrderUpdate).toHaveBeenCalled();
  });

  it('Gap #7/#12 — all writes happen inside a single $transaction', async () => {
    const { svc, prisma } = makeService({});
    await svc.verifyOrder('mo-1', 'admin-A');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('Gap #7 — flips final status to EXCEPTION_QUEUE when one sub-order is unserviceable', async () => {
    const { svc, txMasterOrderUpdate } = makeService({
      allocations: [{ serviceable: true }, { serviceable: false }],
    });
    await svc.verifyOrder('mo-1', 'admin-A');
    // Last masterOrder.update call inside the tx carries the final status.
    const lastCall = txMasterOrderUpdate.mock.calls.at(-1)?.[0];
    expect(lastCall.data.orderStatus).toBe('EXCEPTION_QUEUE');
  });

  it('Gap #7 — flips final status to ROUTED_TO_SELLER when all sub-orders serviceable', async () => {
    const { svc, txMasterOrderUpdate } = makeService({
      allocations: [{ serviceable: true }, { serviceable: true }],
    });
    await svc.verifyOrder('mo-1', 'admin-A');
    const lastCall = txMasterOrderUpdate.mock.calls.at(-1)?.[0];
    expect(lastCall.data.orderStatus).toBe('ROUTED_TO_SELLER');
  });

  it('Gap #12 — sub-order acceptDeadlineAt only set for serviceable sub-orders', async () => {
    const { svc, txSubOrderUpdate } = makeService({
      allocations: [{ serviceable: true }, { serviceable: false }],
    });
    await svc.verifyOrder('mo-1', 'admin-A');
    // Only so-1 (serviceable) gets a deadline update; so-2 doesn't.
    expect(txSubOrderUpdate).toHaveBeenCalledTimes(1);
    const arg = txSubOrderUpdate.mock.calls[0]![0];
    expect(arg.where.id).toBe('so-1');
    expect(arg.data.acceptDeadlineAt).toBeInstanceOf(Date);
  });

  it('Gap #11 — writes ORDER_VERIFIED audit log with verifier + risk snapshot', async () => {
    const { svc, auditFacade } = makeService({});
    await svc.verifyOrder('mo-1', 'admin-A', 'looks good', { ipAddress: '1.1.1.1', userAgent: 'curl' });
    expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_VERIFIED',
        actorId: 'admin-A',
        actorRole: 'ADMIN',
        resourceId: 'mo-1',
        ipAddress: '1.1.1.1',
        userAgent: 'curl',
        metadata: expect.objectContaining({
          orderNumber: 'SM20260042',
          riskBand: 'GREEN',
          riskScore: 10,
          remarks: 'looks good',
          subOrderCount: 2,
          servicedSubOrderCount: 2,
        }),
      }),
    );
  });

  it('Gap #11 — audit log failures do not break the verify response', async () => {
    const { svc, auditFacade } = makeService({});
    auditFacade.writeAuditLog.mockRejectedValueOnce(new Error('audit down'));
    await expect(svc.verifyOrder('mo-1', 'admin-A')).resolves.toBeTruthy();
  });
});
