/**
 * Phase 15 (2026-05-16) — sellerRejectOrder behavioural coverage.
 *
 * Pre-Phase-15 the 149-line method had only role-matrix references and
 * an FSM-doc comment — no behavioural test exercised the 5-phase flow:
 *
 *   1. Validation (not-found, already-rejected)
 *   2. Mark current sub-order REJECTED/CANCELLED
 *   3. Restore stock for the rejected seller's reservations (CONFIRMED
 *      → restoreStockFromConfirmedReservation, RESERVED → release)
 *   4. Attempt reassignment via `catalogFacade.allocateAndReserve`
 *      with the rejected sellers' mapping ids excluded
 *   5. Fallback to EXCEPTION_QUEUE + emit master-exception event
 *
 * This spec mocks the orderRepo + catalogFacade + eventBus boundaries
 * and asserts each branch end-to-end. We keep mocks shallow on
 * purpose — the goal is to lock in the WHAT (which method was called
 * with which args) per branch, not the HOW of the repository
 * implementation.
 */
import 'reflect-metadata';
import { OrdersService } from './orders.service';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../core/exceptions';

const OPEN_SUB_ORDER = {
  id: 'so-1',
  sellerId: 'seller-A',
  acceptStatus: 'OPEN',
  paymentStatus: 'PAID',
  items: [
    {
      id: 'oi-1',
      productId: 'prod-1',
      variantId: null,
      quantity: 2,
      unitPrice: 1000,
      totalPrice: 2000,
      productTitle: 'Test Product',
      variantTitle: null,
      sku: 'SKU-1',
      masterSku: 'SKU-1',
      imageUrl: null,
    },
  ],
  masterOrder: {
    id: 'mo-1',
    orderNumber: 'SM-001',
    customerId: 'cust-1',
    shippingAddressSnapshot: { postalCode: '110001' },
  },
};

function buildService(overrides: Partial<{
  findSubOrderForSellerWithDetails: any;
  findStockReservations: any;
  findSubOrdersByMasterOrder: any;
  findSellerProductMappingIds: any;
  allocateAndReserve: any;
}> = {}) {
  const orderRepo = {
    findSubOrderForSellerWithDetails: jest
      .fn()
      .mockResolvedValue(
        // `??` treats null as missing — explicit `in` check so a
        // test that wants to simulate "no row found" can pass null.
        'findSubOrderForSellerWithDetails' in overrides
          ? overrides.findSubOrderForSellerWithDetails
          : OPEN_SUB_ORDER,
      ),
    updateSubOrder: jest.fn().mockResolvedValue(undefined),
    findStockReservations: jest
      .fn()
      .mockResolvedValue(overrides.findStockReservations ?? []),
    restoreStockFromConfirmedReservation: jest.fn().mockResolvedValue(undefined),
    releaseReservedStock: jest.fn().mockResolvedValue(undefined),
    findSubOrdersByMasterOrder: jest
      .fn()
      .mockResolvedValue(overrides.findSubOrdersByMasterOrder ?? []),
    findSellerProductMappingIds: jest
      .fn()
      .mockResolvedValue(overrides.findSellerProductMappingIds ?? []),
    createSubOrder: jest.fn().mockResolvedValue({ id: 'so-2' }),
    updateMasterOrder: jest.fn().mockResolvedValue(undefined),
    createReassignmentLog: jest.fn().mockResolvedValue(undefined),
  };
  const catalogFacade = {
    allocateAndReserve: jest.fn().mockResolvedValue(
      overrides.allocateAndReserve ?? {
        allocation: {},
        reservation: { id: 'res-99' },
        chosenCandidate: {
          mappingId: 'map-99',
          sellerId: 'seller-B',
          sellerName: 'Alt Seller',
        },
        chosenRank: 'primary',
        skippedMappingIds: [],
      },
    ),
    confirmReservation: jest.fn().mockResolvedValue(undefined),
  };
  const eventBus = {
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const franchiseFacade = {} as any;
  const prisma = {} as any;
  const stockRestore = {} as any;
  const env = {
    getNumber: jest.fn((_k: string, def: number) => def),
  } as any;
  const taxFacade = {} as any;

  const service = new OrdersService(
    orderRepo as any,
    eventBus as any,
    catalogFacade as any,
    franchiseFacade,
    prisma,
    stockRestore,
    env,
    taxFacade,
  );
  return { service, orderRepo, catalogFacade, eventBus };
}

describe('OrdersService.sellerRejectOrder (Phase 15)', () => {
  it('throws NotFoundAppException when the sub-order does not belong to the seller', async () => {
    const { service } = buildService({
      findSubOrderForSellerWithDetails: null,
    });
    await expect(
      service.sellerRejectOrder('so-1', 'seller-A'),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws BadRequestAppException when acceptStatus is not OPEN', async () => {
    const { service } = buildService({
      findSubOrderForSellerWithDetails: { ...OPEN_SUB_ORDER, acceptStatus: 'ACCEPTED' },
    });
    await expect(
      service.sellerRejectOrder('so-1', 'seller-A'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('flips the sub-order to REJECTED/CANCELLED with the supplied reason + note', async () => {
    const { service, orderRepo } = buildService();
    await service.sellerRejectOrder('so-1', 'seller-A', {
      reason: 'out-of-stock',
      note: 'last unit damaged',
    });
    expect(orderRepo.updateSubOrder).toHaveBeenCalledWith(
      'so-1',
      expect.objectContaining({
        acceptStatus: 'REJECTED',
        fulfillmentStatus: 'CANCELLED',
        rejectionReason: 'out-of-stock',
        rejectionNote: 'last unit damaged',
      }),
    );
  });

  it('restores stock for CONFIRMED reservations via restoreStockFromConfirmedReservation', async () => {
    const { service, orderRepo } = buildService({
      findStockReservations: [
        { id: 'res-1', mappingId: 'map-1', quantity: 2, status: 'CONFIRMED' },
      ],
    });
    await service.sellerRejectOrder('so-1', 'seller-A');
    expect(orderRepo.restoreStockFromConfirmedReservation).toHaveBeenCalledWith(
      'res-1',
      'map-1',
      2,
    );
    expect(orderRepo.releaseReservedStock).not.toHaveBeenCalled();
  });

  it('releases RESERVED-state reservations via releaseReservedStock', async () => {
    const { service, orderRepo } = buildService({
      findStockReservations: [
        { id: 'res-2', mappingId: 'map-2', quantity: 1, status: 'RESERVED' },
      ],
    });
    await service.sellerRejectOrder('so-1', 'seller-A');
    expect(orderRepo.releaseReservedStock).toHaveBeenCalledWith(
      'res-2',
      'map-2',
      1,
    );
    expect(orderRepo.restoreStockFromConfirmedReservation).not.toHaveBeenCalled();
  });

  it('attempts reassignment with the rejecting seller excluded', async () => {
    const { service, catalogFacade } = buildService();
    await service.sellerRejectOrder('so-1', 'seller-A');
    expect(catalogFacade.allocateAndReserve).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'prod-1',
        customerPincode: '110001',
        quantity: 2,
        orderId: 'mo-1',
      }),
    );
  });

  it('creates a new sub-order for the chosen alternative seller on success', async () => {
    const { service, orderRepo, catalogFacade } = buildService();
    await service.sellerRejectOrder('so-1', 'seller-A');
    expect(catalogFacade.confirmReservation).toHaveBeenCalledWith(
      'res-99',
      'mo-1',
    );
    expect(orderRepo.createSubOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        masterOrderId: 'mo-1',
        sellerId: 'seller-B',
        acceptStatus: 'OPEN',
        fulfillmentStatus: 'UNFULFILLED',
      }),
    );
  });

  it('emits orders.sub_order.created on successful reassignment', async () => {
    const { service, eventBus } = buildService();
    await service.sellerRejectOrder('so-1', 'seller-A');
    const subOrderCreated = (eventBus.publish as jest.Mock).mock.calls.find(
      ([e]) => e?.eventName === 'orders.sub_order.created',
    );
    expect(subOrderCreated).toBeDefined();
    expect(subOrderCreated[0].payload).toMatchObject({
      sellerId: 'seller-B',
      isReassignment: true,
    });
  });

  it('flips master order to EXCEPTION_QUEUE when no alternative seller is available', async () => {
    // allocateAndReserve throws — no candidate.
    const { service, orderRepo, eventBus } = buildService({
      allocateAndReserve: undefined,
    });
    // Override the allocateAndReserve to throw on every call.
    const catalogFacade = (service as any).catalogFacade;
    catalogFacade.allocateAndReserve.mockRejectedValue(
      new Error('No serviceable candidates'),
    );

    await service.sellerRejectOrder('so-1', 'seller-A');

    expect(orderRepo.updateMasterOrder).toHaveBeenCalledWith(
      'mo-1',
      expect.objectContaining({ orderStatus: 'EXCEPTION_QUEUE' }),
    );
    const exception = (eventBus.publish as jest.Mock).mock.calls.find(
      ([e]) => e?.eventName === 'orders.master.exception',
    );
    expect(exception).toBeDefined();
  });

  it('skips reassignment when customerPincode is missing from the address snapshot', async () => {
    const { service, catalogFacade, orderRepo } = buildService({
      findSubOrderForSellerWithDetails: {
        ...OPEN_SUB_ORDER,
        masterOrder: { ...OPEN_SUB_ORDER.masterOrder, shippingAddressSnapshot: {} },
      },
    });
    await service.sellerRejectOrder('so-1', 'seller-A');
    expect(catalogFacade.allocateAndReserve).not.toHaveBeenCalled();
    expect(orderRepo.updateMasterOrder).toHaveBeenCalledWith(
      'mo-1',
      expect.objectContaining({ orderStatus: 'EXCEPTION_QUEUE' }),
    );
  });

  it('always emits orders.sub_order.rejected_needs_discount_recalc so the discount recalc handler can run', async () => {
    const { service, eventBus } = buildService();
    await service.sellerRejectOrder('so-1', 'seller-A');
    const recalc = (eventBus.publish as jest.Mock).mock.calls.find(
      ([e]) =>
        e?.eventName === 'orders.sub_order.rejected_needs_discount_recalc',
    );
    expect(recalc).toBeDefined();
    expect(recalc[0].payload).toMatchObject({
      rejectedSubOrderId: 'so-1',
      fromSellerId: 'seller-A',
      reassigned: true,
    });
  });

  it('writes a reassignment log entry with successful=true on reassignment', async () => {
    const { service, orderRepo } = buildService();
    await service.sellerRejectOrder('so-1', 'seller-A');
    expect(orderRepo.createReassignmentLog).toHaveBeenCalledWith(
      expect.objectContaining({
        subOrderId: 'so-1',
        fromSellerId: 'seller-A',
        toSellerId: 'seller-B',
        successful: true,
      }),
    );
  });
});
