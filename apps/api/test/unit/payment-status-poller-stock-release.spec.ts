import { PaymentStatusPollerService } from '../../src/modules/payments/application/services/payment-status-poller.service';

/**
 * Regression test for the payment-timeout stock-restoration bug.
 *
 * Before the fix, `cancelExpiredPayments` only flipped order/sub-order
 * statuses to CANCELLED and left StockReservation rows stranded in
 * RESERVED/CONFIRMED state — reservedQty/stockQty on SellerProductMapping
 * never got released, so customer #1's abandoned cart permanently held
 * stock against customer #2.
 *
 * The fix releases stock inside the same $transaction as the status flips
 * (mirrors orders.service.ts:478-508 for admin cancel) and best-effort
 * calls franchiseFacade.unreserveStock per franchise sub-order item.
 */

describe('PaymentStatusPollerService.cancelExpiredPayments — stock release', () => {
  const buildDeps = (opts: {
    expiredOrders: Array<{ id: string; orderNumber: string; customerId: string; totalAmount: number }>;
    reservations: Array<{ id: string; mappingId: string; quantity: number; status: 'RESERVED' | 'CONFIRMED' }>;
    franchiseSubOrders?: Array<{
      franchiseId: string | null;
      items: Array<{ productId: string; variantId: string | null; quantity: number }>;
    }>;
  }) => {
    const tx: any = {
      masterOrder: { update: jest.fn().mockResolvedValue({}) },
      subOrder: { updateMany: jest.fn().mockResolvedValue({}) },
      stockReservation: {
        findMany: jest.fn().mockResolvedValue(opts.reservations),
        update: jest.fn().mockResolvedValue({}),
      },
      sellerProductMapping: { update: jest.fn().mockResolvedValue({}) },
    };

    const prisma: any = {
      masterOrder: { findMany: jest.fn().mockResolvedValue(opts.expiredOrders) },
      subOrder: {
        findMany: jest.fn().mockResolvedValue(opts.franchiseSubOrders ?? []),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const redis: any = { acquireLock: jest.fn(), releaseLock: jest.fn() };
    const envService: any = {
      getNumber: (_k: string, d: number) => d,
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const razorpayAdapter: any = {};
    const franchiseFacade: any = {
      unreserveStock: jest.fn().mockResolvedValue(undefined),
    };

    const svc = new PaymentStatusPollerService(
      prisma,
      redis,
      envService,
      eventBus,
      razorpayAdapter,
      franchiseFacade,
    );
    return { svc, prisma, tx, franchiseFacade };
  };

  const callCancel = async (svc: PaymentStatusPollerService) => {
    // cancelExpiredPayments is private; invoke via the type-erased handle
    // so the test stays honest to the public contract but can exercise the
    // specific branch we care about.
    await (svc as any).cancelExpiredPayments();
  };

  it('releases a RESERVED reservation by decrementing reservedQty', async () => {
    const { svc, tx } = buildDeps({
      expiredOrders: [
        { id: 'order-1', orderNumber: 'ORD-1', customerId: 'c1', totalAmount: 100 },
      ],
      reservations: [
        { id: 'res-1', mappingId: 'map-1', quantity: 3, status: 'RESERVED' },
      ],
    });

    await callCancel(svc);

    expect(tx.stockReservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'RELEASED' },
    });
    expect(tx.sellerProductMapping.update).toHaveBeenCalledWith({
      where: { id: 'map-1' },
      data: { reservedQty: { decrement: 3 } },
    });
  });

  it('releases a CONFIRMED reservation by restoring stockQty', async () => {
    const { svc, tx } = buildDeps({
      expiredOrders: [
        { id: 'order-2', orderNumber: 'ORD-2', customerId: 'c2', totalAmount: 200 },
      ],
      reservations: [
        { id: 'res-2', mappingId: 'map-2', quantity: 5, status: 'CONFIRMED' },
      ],
    });

    await callCancel(svc);

    expect(tx.sellerProductMapping.update).toHaveBeenCalledWith({
      where: { id: 'map-2' },
      data: { stockQty: { increment: 5 } },
    });
  });

  it('unreserves franchise stock via the facade for franchise sub-orders', async () => {
    const { svc, franchiseFacade } = buildDeps({
      expiredOrders: [
        { id: 'order-3', orderNumber: 'ORD-3', customerId: 'c3', totalAmount: 50 },
      ],
      reservations: [],
      franchiseSubOrders: [
        {
          franchiseId: 'fr-1',
          items: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
        },
      ],
    });

    await callCancel(svc);

    expect(franchiseFacade.unreserveStock).toHaveBeenCalledWith(
      'fr-1',
      'p1',
      'v1',
      2,
      'order-3',
    );
  });

  it('does not call franchise facade for seller-only orders', async () => {
    const { svc, franchiseFacade } = buildDeps({
      expiredOrders: [
        { id: 'order-4', orderNumber: 'ORD-4', customerId: 'c4', totalAmount: 75 },
      ],
      reservations: [
        { id: 'res-4', mappingId: 'map-4', quantity: 1, status: 'RESERVED' },
      ],
      franchiseSubOrders: [],
    });

    await callCancel(svc);

    expect(franchiseFacade.unreserveStock).not.toHaveBeenCalled();
  });

  it('flips master and sub-order statuses to CANCELLED inside the same tx', async () => {
    const { svc, tx } = buildDeps({
      expiredOrders: [
        { id: 'order-5', orderNumber: 'ORD-5', customerId: 'c5', totalAmount: 10 },
      ],
      reservations: [],
    });

    await callCancel(svc);

    expect(tx.masterOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-5' },
      data: { orderStatus: 'CANCELLED', paymentStatus: 'CANCELLED' },
    });
    expect(tx.subOrder.updateMany).toHaveBeenCalledWith({
      where: { masterOrderId: 'order-5' },
      data: {
        paymentStatus: 'CANCELLED',
        fulfillmentStatus: 'CANCELLED',
        acceptStatus: 'CANCELLED',
      },
    });
  });
});
