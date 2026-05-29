// Phase 74 (2026-05-22) — Phase 73 approve/reject audit hardening.
//
// Covers:
//   Gap #1  — prepaid orders trigger refund saga via RefundInstructionService
//   Gap #2  — rejectOrder takes (id, adminId, reason); columns written
//   Gap #3  — audit log row written + OrderVerificationDecision row in tx
//   Gap #5  — cross-path claim guard rejects when claim held by another admin
//   Gap #11 — franchise unreserve failure emits retry event
//   Gap #12 — previousPaymentStatus snapshot stamped before flip
//   Gap #15 — orderStatus → REJECTED (not CANCELLED)
//   Gap #17/#18 — orders.master.rejected event emitted
//   Gap #20 — status precondition re-checked inside tx (updateMany count=0
//             on lost race throws)

import { OrdersService } from './orders.service';

function makeSvc(opts: {
  order?: any;
  txUpdateCount?: number;
  franchiseThrows?: boolean;
  refundThrows?: boolean;
} = {}) {
  const order = opts.order ?? {
    id: 'mo-rej',
    orderNumber: 'SM-RJ',
    customerId: 'c-1',
    orderStatus: 'PLACED',
    paymentStatus: 'PAID',
    totalAmount: 500,
    subOrders: [
      {
        id: 'so-1',
        fulfillmentNodeType: 'SELLER',
        franchiseId: null,
        items: [{ productId: 'p-1', variantId: null, quantity: 1 }],
      },
    ],
    claimedByAdminId: null,
    claimExpiresAt: null,
  };

  const txMasterOrderUpdateMany = jest.fn().mockResolvedValue({
    count: opts.txUpdateCount ?? 1,
  });
  const txSubOrderUpdate = jest.fn().mockResolvedValue({});
  const txDecisionCreate = jest.fn().mockResolvedValue({});
  const orderRepo: any = {
    findMasterOrderById: jest.fn().mockResolvedValue(order),
    executeTransaction: jest.fn(async (cb: any) =>
      cb({
        masterOrder: { updateMany: txMasterOrderUpdateMany },
        subOrder: { update: txSubOrderUpdate },
        orderVerificationDecision: { create: txDecisionCreate },
      }),
    ),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const catalogFacade: any = { allocate: jest.fn() };
  const franchiseFacade: any = {
    unreserveStock: opts.franchiseThrows
      ? jest.fn().mockRejectedValue(new Error('franchise down'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const prisma: any = {};
  const stockRestore: any = {
    restoreForOrder: jest.fn().mockResolvedValue(undefined),
  };
  const env: any = { getNumber: () => 14 };
  const taxFacade: any = {};
  const auditFacade: any = {
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
  const refundInstructions: any = {
    createSplitForRefund: opts.refundThrows
      ? jest.fn().mockRejectedValue(new Error('refund saga down'))
      : jest.fn().mockResolvedValue([{ id: 'ri-1' }]),
  };

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
    refundInstructions,
  );
  return {
    svc,
    eventBus,
    auditFacade,
    refundInstructions,
    franchiseFacade,
    txMasterOrderUpdateMany,
    txSubOrderUpdate,
    txDecisionCreate,
  };
}

describe('OrdersService.rejectOrder (Phase 74)', () => {
  it('Gap #1 — prepaid order enqueues refund saga', async () => {
    const { svc, refundInstructions } = makeSvc();
    await svc.rejectOrder('mo-rej', 'admin-A', 'Customer unreachable on phone');
    expect(refundInstructions.createSplitForRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'VERIFICATION_REJECTION',
        masterOrderId: 'mo-rej',
        amountInPaise: 50_000n,
        baseIdempotencyKey: 'verification-reject:mo-rej',
      }),
    );
  });

  it('Gap #1 — COD order does NOT trigger refund', async () => {
    const { svc, refundInstructions } = makeSvc({
      order: {
        id: 'mo-cod',
        orderNumber: 'SM-COD',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'PENDING',
        totalAmount: 200,
        subOrders: [],
        claimedByAdminId: null,
        claimExpiresAt: null,
      },
    });
    await svc.rejectOrder('mo-cod', 'admin-A', 'Customer unreachable');
    expect(refundInstructions.createSplitForRefund).not.toHaveBeenCalled();
  });

  it('Gap #1 — refund failure emits orders.refund.required event but doesn\'t roll back rejection', async () => {
    const { svc, eventBus } = makeSvc({ refundThrows: true });
    await expect(
      svc.rejectOrder('mo-rej', 'admin-A', 'Customer unreachable'),
    ).resolves.toBeUndefined();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.refund.required',
        payload: expect.objectContaining({ masterOrderId: 'mo-rej' }),
      }),
    );
  });

  it('Gap #2/#12 — writes previousPaymentStatus + rejectedBy + rejectionReason in tx', async () => {
    const { svc, txMasterOrderUpdateMany } = makeSvc();
    await svc.rejectOrder('mo-rej', 'admin-A', 'Customer unreachable');
    expect(txMasterOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderStatus: 'REJECTED',
          paymentStatus: 'CANCELLED',
          previousPaymentStatus: 'PAID',
          rejectedBy: 'admin-A',
          rejectionReason: 'Customer unreachable',
        }),
      }),
    );
  });

  it('Gap #15 — orderStatus becomes REJECTED (not CANCELLED)', async () => {
    const { svc, txMasterOrderUpdateMany } = makeSvc();
    await svc.rejectOrder('mo-rej', 'admin-A', 'Reason here');
    const call = txMasterOrderUpdateMany.mock.calls[0]![0];
    expect(call.data.orderStatus).toBe('REJECTED');
  });

  it('Gap #20 — status precondition is part of the WHERE clause', async () => {
    const { svc, txMasterOrderUpdateMany } = makeSvc();
    await svc.rejectOrder('mo-rej', 'admin-A', 'Reason');
    const call = txMasterOrderUpdateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({
      paymentStatus: { not: 'CANCELLED' },
      orderStatus: expect.objectContaining({
        notIn: expect.arrayContaining(['ROUTED_TO_SELLER', 'REJECTED']),
      }),
    });
  });

  it('Gap #20 — lost-race throws when updateMany count=0', async () => {
    const { svc } = makeSvc({ txUpdateCount: 0 });
    await expect(
      svc.rejectOrder('mo-rej', 'admin-A', 'Reason'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('concurrently'),
    });
  });

  it('Gap #3 — writes OrderVerificationDecision row + audit log', async () => {
    const { svc, txDecisionCreate, auditFacade } = makeSvc();
    await svc.rejectOrder('mo-rej', 'admin-A', 'Reason text', {
      ipAddress: '5.5.5.5',
      userAgent: 'jest',
    });
    expect(txDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          masterOrderId: 'mo-rej',
          decision: 'REJECTED',
          decidedBy: 'admin-A',
          reason: 'Reason text',
        }),
      }),
    );
    expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_REJECTED',
        actorId: 'admin-A',
        resourceId: 'mo-rej',
        ipAddress: '5.5.5.5',
      }),
    );
  });

  it('Gap #17/#18 — emits orders.master.rejected event', async () => {
    const { svc, eventBus } = makeSvc();
    await svc.rejectOrder('mo-rej', 'admin-A', 'Reason');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.master.rejected',
        payload: expect.objectContaining({
          masterOrderId: 'mo-rej',
          rejectedBy: 'admin-A',
          previousPaymentStatus: 'PAID',
          refundRequired: true,
        }),
      }),
    );
  });

  it('Gap #5 — blocks reject when another admin holds the queue claim', async () => {
    const { svc } = makeSvc({
      order: {
        id: 'mo-cl',
        orderNumber: 'SM-CL',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        totalAmount: 500,
        subOrders: [],
        claimedByAdminId: 'admin-B',
        claimExpiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    await expect(
      svc.rejectOrder('mo-cl', 'admin-A', 'Reason'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('held by another verifier'),
    });
  });

  it('Gap #11 — franchise unreserve failure emits retry event', async () => {
    const { svc, eventBus } = makeSvc({
      franchiseThrows: true,
      order: {
        id: 'mo-fr',
        orderNumber: 'SM-FR',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'PENDING',
        totalAmount: 200,
        subOrders: [
          {
            id: 'so-fr',
            fulfillmentNodeType: 'FRANCHISE',
            franchiseId: 'fr-1',
            items: [{ productId: 'p-1', variantId: null, quantity: 1 }],
          },
        ],
        claimedByAdminId: null,
        claimExpiresAt: null,
      },
    });
    await svc.rejectOrder('mo-fr', 'admin-A', 'Reason');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.franchise.unreserve_required',
        payload: expect.objectContaining({
          masterOrderId: 'mo-fr',
          franchiseId: 'fr-1',
          productId: 'p-1',
        }),
      }),
    );
  });

  it('Gap #2 — sub-order rejectionReason column is written (was unused pre-Phase-74)', async () => {
    const { svc, txSubOrderUpdate } = makeSvc();
    await svc.rejectOrder('mo-rej', 'admin-A', 'My specific reason');
    expect(txSubOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: 'CANCELLED',
          acceptStatus: 'REJECTED',
          rejectionReason: 'My specific reason',
        }),
      }),
    );
  });
});
