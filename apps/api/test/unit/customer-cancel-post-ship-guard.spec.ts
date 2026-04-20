import 'reflect-metadata';
import { CustomerOrdersService } from '../../src/modules/checkout/application/services/customer-orders.service';

/**
 * Regression test for self-cancel of shipped/delivered orders.
 *
 * Before: cancelOrder only rejected the cancel when return window had
 * already EXPIRED on a DELIVERED sub-order. For DELIVERED + within-window
 * (and for SHIPPED at any time) the cancel proceeded, running
 * cancelOrderTransaction. That transaction unconditionally restores stock
 * and marks the commission REFUNDED — correct for pre-ship orders, a
 * self-service zero-QC refund for goods-in-hand. Net effect: customer
 * keeps the goods *and* gets their money back, seller loses both.
 *
 * After: cancel rejects for any sub-order whose fulfillmentStatus is
 * SHIPPED, DELIVERED, or FULFILLED. The customer is told to use the
 * returns flow, which goes through QC and only restores stock after the
 * goods are physically received back.
 */

describe('CustomerOrdersService.cancelOrder — post-ship guard', () => {
  const buildSvc = (order: any) => {
    const repo: any = {
      findMasterOrderWithSubOrders: jest.fn().mockResolvedValue(order),
      cancelOrderTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new CustomerOrdersService(repo);
    return { svc, repo };
  };

  const buildOrder = (statuses: string[]) => ({
    id: 'ord-1',
    orderNumber: 'ORD-1',
    paymentStatus: 'PAID',
    subOrders: statuses.map((s, i) => ({
      id: `so-${i}`,
      fulfillmentStatus: s,
      returnWindowEndsAt: null,
    })),
  });

  it('rejects cancel when any sub-order is DELIVERED', async () => {
    const { svc, repo } = buildSvc(buildOrder(['UNFULFILLED', 'DELIVERED']));

    await expect(svc.cancelOrder('u1', 'ORD-1')).rejects.toThrow(
      /already shipped or been delivered/i,
    );
    expect(repo.cancelOrderTransaction).not.toHaveBeenCalled();
  });

  it('rejects cancel when any sub-order is SHIPPED', async () => {
    const { svc, repo } = buildSvc(buildOrder(['SHIPPED']));

    await expect(svc.cancelOrder('u1', 'ORD-1')).rejects.toThrow(
      /already shipped or been delivered/i,
    );
    expect(repo.cancelOrderTransaction).not.toHaveBeenCalled();
  });

  it('rejects cancel when any sub-order is FULFILLED', async () => {
    const { svc, repo } = buildSvc(buildOrder(['FULFILLED']));

    await expect(svc.cancelOrder('u1', 'ORD-1')).rejects.toThrow(
      /already shipped or been delivered/i,
    );
    expect(repo.cancelOrderTransaction).not.toHaveBeenCalled();
  });

  it('allows cancel for UNFULFILLED / PACKED sub-orders only', async () => {
    const { svc, repo } = buildSvc(buildOrder(['UNFULFILLED', 'PACKED']));

    await svc.cancelOrder('u1', 'ORD-1');
    expect(repo.cancelOrderTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects cancel when order already cancelled', async () => {
    const order = buildOrder(['UNFULFILLED']);
    order.paymentStatus = 'CANCELLED';
    const { svc, repo } = buildSvc(order);

    await expect(svc.cancelOrder('u1', 'ORD-1')).rejects.toThrow(
      /already cancelled/i,
    );
    expect(repo.cancelOrderTransaction).not.toHaveBeenCalled();
  });
});
