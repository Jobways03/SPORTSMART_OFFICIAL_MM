/**
 * Phase 197 — checkout CustomerOrdersService.
 *
 *   #20 — legacy POST /customer/orders place-order is gated OFF behind
 *         LEGACY_PLACE_ORDER_ENABLED (default false).
 *   #11 — cancelOrder writes an audit log (order.cancelled).
 *   #15 — the cheap pre-check still rejects an already-shipped order
 *         (the authoritative re-check lives in the repo tx, covered in
 *         the repo cancel-race spec).
 */
import 'reflect-metadata';
import { CustomerOrdersService } from './customer-orders.service';

function build(over: { repo?: any; audit?: any } = {}) {
  const repo: any = {
    findAddressByIdAndCustomer: jest.fn(),
    findCartWithLegacyItems: jest.fn(),
    legacyPlaceOrderTransaction: jest.fn().mockResolvedValue({ orderNumber: 'SM1' }),
    findMasterOrderWithSubOrders: jest.fn(),
    cancelOrderTransaction: jest.fn().mockResolvedValue(undefined),
    ...over.repo,
  };
  const audit: any = {
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
    ...over.audit,
  };
  const svc = new CustomerOrdersService(repo, audit);
  return { svc, repo, audit };
}

describe('CustomerOrdersService legacy place-order gate (Phase 197 #20)', () => {
  const ORIGINAL = process.env.LEGACY_PLACE_ORDER_ENABLED;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LEGACY_PLACE_ORDER_ENABLED;
    else process.env.LEGACY_PLACE_ORDER_ENABLED = ORIGINAL;
  });

  it('is OFF by default — rejects the legacy place-order', async () => {
    delete process.env.LEGACY_PLACE_ORDER_ENABLED;
    const { svc, repo } = build();
    await expect(svc.placeOrder('c-1', 'addr-1')).rejects.toThrow(
      /no longer supported/i,
    );
    expect(repo.legacyPlaceOrderTransaction).not.toHaveBeenCalled();
  });

  it('runs only when explicitly enabled', async () => {
    process.env.LEGACY_PLACE_ORDER_ENABLED = 'true';
    const { svc, repo } = build({
      repo: {
        findAddressByIdAndCustomer: jest.fn().mockResolvedValue({ id: 'addr-1', fullName: 'A' }),
        findCartWithLegacyItems: jest.fn().mockResolvedValue({ items: [{ id: 'ci-1' }] }),
      },
    });
    await svc.placeOrder('c-1', 'addr-1');
    expect(repo.legacyPlaceOrderTransaction).toHaveBeenCalled();
  });
});

describe('CustomerOrdersService cancel (Phase 197 #11/#15)', () => {
  it('rejects cancel when a sub-order has already shipped (pre-check)', async () => {
    const { svc, repo } = build({
      repo: {
        findMasterOrderWithSubOrders: jest.fn().mockResolvedValue({
          id: 'mo-1',
          orderNumber: 'SM1',
          orderStatus: 'DISPATCHED',
          paymentStatus: 'PENDING',
          subOrders: [{ id: 'so-1', fulfillmentStatus: 'SHIPPED' }],
        }),
      },
    });
    await expect(svc.cancelOrder('c-1', 'SM1')).rejects.toThrow(
      /already shipped or been delivered/i,
    );
    expect(repo.cancelOrderTransaction).not.toHaveBeenCalled();
  });

  it('cancels a pre-ship order and writes an audit log', async () => {
    const { svc, repo, audit } = build({
      repo: {
        findMasterOrderWithSubOrders: jest.fn().mockResolvedValue({
          id: 'mo-1',
          orderNumber: 'SM1',
          orderStatus: 'PLACED',
          paymentStatus: 'PENDING',
          subOrders: [{ id: 'so-1', fulfillmentStatus: 'UNFULFILLED' }],
        }),
      },
    });
    const res = await svc.cancelOrder('c-1', 'SM1');
    expect(res).toEqual({ success: true });
    expect(repo.cancelOrderTransaction).toHaveBeenCalled();
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.cancelled', resourceId: 'mo-1' }),
    );
  });

  it('rejects an already-cancelled order', async () => {
    const { svc } = build({
      repo: {
        findMasterOrderWithSubOrders: jest.fn().mockResolvedValue({
          id: 'mo-1',
          orderNumber: 'SM1',
          orderStatus: 'CANCELLED',
          paymentStatus: 'CANCELLED',
          subOrders: [],
        }),
      },
    });
    await expect(svc.cancelOrder('c-1', 'SM1')).rejects.toThrow(/already cancelled/i);
  });
});
