// Phase 69 (2026-05-22) — Phase 68 audit Gap #8.
//
// Stock re-reservation pass at verify. The OrdersService.verifyOrder
// post-tx loop now calls catalogFacade.ensureConfirmedReservationAtVerify
// for every successfully-routed sub-order item; failures emit
// orders.verify.reservation_gap instead of silently shipping
// under-reserved.

import { OrdersService } from './orders.service';

function makeSvc(over: {
  ensureResult?: { reservationId: string; reused: boolean };
  ensureThrows?: Error;
} = {}) {
  const order = {
    id: 'mo-1',
    orderNumber: 'SM-42',
    customerId: 'c-1',
    orderStatus: 'PLACED',
    paymentStatus: 'PAID',
    shippingAddressSnapshot: { postalCode: '500001' },
    subOrders: [
      {
        id: 'so-1',
        items: [{ id: 'oi-1', productId: 'p-1', variantId: null, quantity: 2 }],
      },
    ],
    verificationRiskBand: 'GREEN',
    claimedByAdminId: null,
    claimExpiresAt: null,
  };

  const orderRepo: any = {
    findMasterOrderById: jest.fn().mockResolvedValue(order),
    updateMasterOrder: jest.fn().mockResolvedValue({}),
    updateSubOrder: jest.fn().mockResolvedValue({}),
  };
  const prisma: any = {
    $transaction: jest.fn(async (cb: any) =>
      cb({
        masterOrder: { update: jest.fn().mockResolvedValue({}) },
        subOrder: { update: jest.fn().mockResolvedValue({}) },
        // Phase 74 — verifyOrder now writes OrderVerificationDecision.
        orderVerificationDecision: { create: jest.fn().mockResolvedValue({}) },
      }),
    ),
    masterOrder: { findUnique: jest.fn().mockResolvedValue({}) },
    orderItem: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const catalogFacade: any = {
    allocate: jest.fn().mockResolvedValue({
      serviceable: true,
      primary: { mappingId: 'mapping-1' },
    }),
    ensureConfirmedReservationAtVerify: over.ensureThrows
      ? jest.fn().mockRejectedValue(over.ensureThrows)
      : jest.fn().mockResolvedValue(
          over.ensureResult ?? { reservationId: 'res-fresh', reused: false },
        ),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const env: any = { getNumber: () => 14 };
  const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const stockRestore: any = {};
  const franchiseFacade: any = {};
  const taxFacade: any = {};

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
  (svc as any).getOrder = jest.fn().mockResolvedValue({ id: 'mo-1' });
  return { svc, catalogFacade, eventBus, prisma };
}

describe('OrdersService.verifyOrder stock re-reservation (Phase 69 — Gap #8)', () => {
  it('calls ensureConfirmedReservationAtVerify for each item', async () => {
    const { svc, catalogFacade } = makeSvc();
    await svc.verifyOrder('mo-1', 'admin-A');
    expect(catalogFacade.ensureConfirmedReservationAtVerify).toHaveBeenCalledWith({
      orderId: 'mo-1',
      mappingId: 'mapping-1',
      quantity: 2,
      customerId: 'c-1',
    });
  });

  it('updates OrderItem.stockReservationId only when a fresh reservation was created', async () => {
    const { svc, prisma } = makeSvc({
      ensureResult: { reservationId: 'res-new', reused: false },
    });
    await svc.verifyOrder('mo-1', 'admin-A');
    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'oi-1' },
      data: { stockReservationId: 'res-new' },
    });
  });

  it('does not update OrderItem when reservation was reused (no-op)', async () => {
    const { svc, prisma } = makeSvc({
      ensureResult: { reservationId: 'res-existing', reused: true },
    });
    await svc.verifyOrder('mo-1', 'admin-A');
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
  });

  it('emits orders.verify.reservation_gap event when ensure throws', async () => {
    const { svc, eventBus } = makeSvc({
      ensureThrows: new Error('mapping out of stock'),
    });
    await svc.verifyOrder('mo-1', 'admin-A');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.verify.reservation_gap',
        aggregateId: 'mo-1',
        payload: expect.objectContaining({
          masterOrderId: 'mo-1',
          orderNumber: 'SM-42',
          failures: expect.arrayContaining([
            expect.objectContaining({
              orderItemId: 'oi-1',
              reason: 'mapping out of stock',
            }),
          ]),
        }),
      }),
    );
  });
});
