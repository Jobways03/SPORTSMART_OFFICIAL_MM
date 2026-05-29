// Phase 75 (2026-05-22) — finalize Phase 73 reject-flow audit deferrals.
//
// Covers:
//   Gap #10 — commissionDecision enum populated alongside
//             commissionProcessed (NOT_APPLICABLE on reject)
//   Gap #23 — previewRouting returns per-item allocation result
//   Gap #25 — per-seller acceptSlaHours propagates to checkout
//             (covered via the placeOrder flow in a downstream spec)

import { OrdersService } from './orders.service';

function makeSvc(opts: {
  order?: any;
  allocateResult?: any;
} = {}) {
  const order = opts.order ?? {
    id: 'mo-1',
    orderNumber: 'SM-1',
    customerId: 'c-1',
    orderStatus: 'PLACED',
    paymentStatus: 'PAID',
    totalAmount: 500,
    shippingAddressSnapshot: { postalCode: '500001' },
    subOrders: [
      {
        id: 'so-1',
        items: [
          {
            id: 'oi-1',
            productId: 'p-1',
            variantId: null,
            quantity: 2,
            productTitle: 'Running Shoes',
          },
        ],
      },
    ],
    claimedByAdminId: null,
    claimExpiresAt: null,
  };

  const orderRepo: any = {
    findMasterOrderById: jest.fn().mockResolvedValue(order),
    executeTransaction: jest.fn(async (cb: any) =>
      cb({
        masterOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        subOrder: { update: jest.fn().mockResolvedValue({}) },
        orderVerificationDecision: { create: jest.fn().mockResolvedValue({}) },
      }),
    ),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const catalogFacade: any = {
    previewServiceability: jest.fn().mockResolvedValue(
      opts.allocateResult ?? {
        serviceable: true,
        primary: {
          mappingId: 'm-1',
          sellerId: 's-1',
          sellerShopName: 'Shop A',
          distanceKm: 3.2,
          nodeType: 'SELLER',
        },
      },
    ),
  };
  const franchiseFacade: any = { unreserveStock: jest.fn() };
  const prisma: any = {};
  const stockRestore: any = { restoreForOrder: jest.fn() };
  const env: any = { getNumber: () => 14 };
  const taxFacade: any = {};
  const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const refundInstructions: any = { createSplitForRefund: jest.fn().mockResolvedValue([]) };

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
  return { svc, catalogFacade, orderRepo };
}

describe('OrdersService.previewRouting (Phase 75 — Gap #23)', () => {
  it('returns per-item allocation result with summary', async () => {
    const { svc } = makeSvc();
    const result = await svc.previewRouting('mo-1');
    expect(result.masterOrderId).toBe('mo-1');
    expect(result.customerPincode).toBe('500001');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      orderItemId: 'oi-1',
      productId: 'p-1',
      quantity: 2,
      productTitle: 'Running Shoes',
      serviceable: true,
      primary: expect.objectContaining({
        sellerShopName: 'Shop A',
        distanceKm: 3.2,
      }),
    });
    expect(result.summary).toEqual({
      totalItems: 1,
      serviceableItems: 1,
      unserviceableItems: 0,
    });
  });

  it('marks items unserviceable when pincode missing', async () => {
    const { svc } = makeSvc({
      order: {
        id: 'mo-np',
        orderNumber: 'SM-NP',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        totalAmount: 500,
        shippingAddressSnapshot: {},
        subOrders: [
          { id: 'so-1', items: [{ id: 'oi-1', productId: 'p-1', variantId: null, quantity: 1, productTitle: 'X' }] },
        ],
        claimedByAdminId: null,
        claimExpiresAt: null,
      },
    });
    const result = await svc.previewRouting('mo-np');
    expect(result.customerPincode).toBeNull();
    expect(result.items[0]!.serviceable).toBe(false);
    expect(result.items[0]!.reason).toMatch(/pincode/);
    expect(result.summary.unserviceableItems).toBe(1);
  });

  it('captures unserviceable reason from allocator', async () => {
    const { svc } = makeSvc({
      allocateResult: {
        serviceable: false,
        primary: null,
        reason: 'No mapping found for pincode 500001',
      },
    });
    const result = await svc.previewRouting('mo-1');
    expect(result.items[0]!.serviceable).toBe(false);
    expect(result.items[0]!.reason).toContain('No mapping found');
  });

  it('uses previewServiceability (read-only, does NOT mutate AllocationLog)', async () => {
    const { svc, catalogFacade } = makeSvc();
    await svc.previewRouting('mo-1');
    expect(catalogFacade.previewServiceability).toHaveBeenCalled();
  });
});

describe('OrdersService.rejectOrder commissionDecision (Phase 75 — Gap #10)', () => {
  it('sets commissionDecision: NOT_APPLICABLE on rejected sub-orders', async () => {
    const subUpdate = jest.fn().mockResolvedValue({});
    const orderRepo: any = {
      findMasterOrderById: jest.fn().mockResolvedValue({
        id: 'mo-1',
        orderNumber: 'SM-1',
        customerId: 'c-1',
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        totalAmount: 500,
        subOrders: [{ id: 'so-1', fulfillmentNodeType: 'SELLER', items: [] }],
        claimedByAdminId: null,
        claimExpiresAt: null,
      }),
      executeTransaction: jest.fn(async (cb: any) =>
        cb({
          masterOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          subOrder: { update: subUpdate },
          orderVerificationDecision: { create: jest.fn().mockResolvedValue({}) },
        }),
      ),
    };
    const eventBus: any = { publish: jest.fn() };
    const catalogFacade: any = { previewServiceability: jest.fn() };
    const franchiseFacade: any = { unreserveStock: jest.fn() };
    const stockRestore: any = { restoreForOrder: jest.fn() };
    const env: any = { getNumber: () => 14 };
    const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const refundInstructions: any = { createSplitForRefund: jest.fn().mockResolvedValue([]) };

    const svc = new OrdersService(
      orderRepo,
      eventBus,
      catalogFacade,
      franchiseFacade,
      {} as any,
      stockRestore,
      env,
      {} as any,
      auditFacade,
      refundInstructions,
    );

    await svc.rejectOrder('mo-1', 'admin-A', 'Customer unreachable on phone');

    expect(subUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commissionProcessed: true,
          commissionDecision: 'NOT_APPLICABLE',
        }),
      }),
    );
  });
});
