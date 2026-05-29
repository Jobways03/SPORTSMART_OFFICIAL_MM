// Phase 87 (2026-05-23) — RTO_DELIVERED side effects.
//
// Asserts Gaps #7/#8: refund saga + stock restore fire on
// shipping.rto.delivered. Wired via @OnEvent + IdempotentHandler;
// here we exercise the handler method directly.

import { RtoSideEffectsHandler } from './rto-side-effects.handler';

function buildPrisma(subOverride: any) {
  return {
    subOrder: { findUnique: jest.fn().mockResolvedValue(subOverride) },
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn({})),
  };
}

function buildDedup() {
  return {
    tryConsume: jest.fn().mockResolvedValue(true),
    isHandled: jest.fn().mockResolvedValue(false),
    markHandled: jest.fn(),
  };
}

function buildEvent(payload: any) {
  return {
    eventName: 'shipping.rto.delivered',
    aggregate: 'SubOrder',
    aggregateId: payload.subOrderId,
    occurredAt: new Date(),
    payload,
  };
}

describe('RtoSideEffectsHandler (Phase 87)', () => {
  it('Gap #7 — prepaid sub-order triggers refund saga with rto idempotency key', async () => {
    const stockRestore: any = {
      restoreForSubOrderItems: jest.fn().mockResolvedValue({ releasedCount: 1 }),
    };
    const refundInstructions: any = {
      createSplitForRefund: jest.fn().mockResolvedValue([]),
    };
    const prisma = buildPrisma({
      id: 'sub-1',
      masterOrderId: 'master-1',
      sellerId: 'seller-1',
      fulfillmentNodeType: 'SELLER',
      subTotalInPaise: 99900n,
      items: [{ productId: 'p1', variantId: 'v1' }],
      masterOrder: {
        id: 'master-1',
        customerId: 'cust-1',
        paymentStatus: 'PAID',
        paymentMethod: 'ONLINE',
      },
    });
    const handler = new RtoSideEffectsHandler(
      prisma as any,
      buildDedup() as any,
      stockRestore,
      refundInstructions,
    );
    await handler.handleRtoDelivered(buildEvent({ subOrderId: 'sub-1' }) as any);
    expect(refundInstructions.createSplitForRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLabel: 'rto-delivered:sub-1',
        baseIdempotencyKey: 'rto-delivered:sub-1',
        amountInPaise: 99900n,
        customerId: 'cust-1',
      }),
    );
  });

  it('Gap #8 — seller-fulfilled sub-order triggers item-scoped stock restore', async () => {
    const stockRestore: any = {
      restoreForSubOrderItems: jest.fn().mockResolvedValue({ releasedCount: 1 }),
    };
    const prisma = buildPrisma({
      id: 'sub-1',
      masterOrderId: 'master-1',
      sellerId: 'seller-1',
      fulfillmentNodeType: 'SELLER',
      subTotalInPaise: 0n,
      items: [
        { productId: 'p1', variantId: 'v1' },
        { productId: 'p2', variantId: null },
      ],
      masterOrder: {
        id: 'master-1',
        customerId: 'cust-1',
        paymentStatus: 'UNPAID',
        paymentMethod: 'COD',
      },
    });
    const handler = new RtoSideEffectsHandler(
      prisma as any,
      buildDedup() as any,
      stockRestore,
    );
    await handler.handleRtoDelivered(buildEvent({ subOrderId: 'sub-1' }) as any);
    expect(stockRestore.restoreForSubOrderItems).toHaveBeenCalledWith(
      expect.anything(),
      'master-1',
      'seller-1',
      [
        { productId: 'p1', variantId: 'v1' },
        { productId: 'p2', variantId: null },
      ],
    );
  });

  it('COD sub-order does NOT trigger refund', async () => {
    const refundInstructions: any = {
      createSplitForRefund: jest.fn(),
    };
    const stockRestore: any = {
      restoreForSubOrderItems: jest.fn().mockResolvedValue({ releasedCount: 0 }),
    };
    const prisma = buildPrisma({
      id: 'sub-1',
      masterOrderId: 'master-1',
      sellerId: 'seller-1',
      fulfillmentNodeType: 'SELLER',
      subTotalInPaise: 99900n,
      items: [{ productId: 'p1', variantId: null }],
      masterOrder: {
        id: 'master-1',
        customerId: 'cust-1',
        paymentStatus: 'UNPAID',
        paymentMethod: 'COD',
      },
    });
    const handler = new RtoSideEffectsHandler(
      prisma as any,
      buildDedup() as any,
      stockRestore,
      refundInstructions,
    );
    await handler.handleRtoDelivered(buildEvent({ subOrderId: 'sub-1' }) as any);
    expect(refundInstructions.createSplitForRefund).not.toHaveBeenCalled();
  });

  it('Franchise sub-order skips seller stock restore (handled elsewhere)', async () => {
    const stockRestore: any = {
      restoreForSubOrderItems: jest.fn(),
    };
    const prisma = buildPrisma({
      id: 'sub-1',
      masterOrderId: 'master-1',
      sellerId: null,
      franchiseId: 'fr-1',
      fulfillmentNodeType: 'FRANCHISE',
      subTotalInPaise: 0n,
      items: [],
      masterOrder: {
        id: 'master-1',
        customerId: 'cust-1',
        paymentStatus: 'UNPAID',
        paymentMethod: 'COD',
      },
    });
    const handler = new RtoSideEffectsHandler(
      prisma as any,
      buildDedup() as any,
      stockRestore,
    );
    await handler.handleRtoDelivered(buildEvent({ subOrderId: 'sub-1' }) as any);
    expect(stockRestore.restoreForSubOrderItems).not.toHaveBeenCalled();
  });
});
