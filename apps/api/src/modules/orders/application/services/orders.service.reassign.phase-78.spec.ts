// Phase 78 (2026-05-22) — order reassignment hardening.
//
// Covers the audit gaps closed in OrdersService.reassignSubOrder:
//   Gap #1/#4   reason mandatory (10+ chars) — controller and service
//   Gap #5      reassignedBy admin actor persisted
//   Gap #8/#22  fromNodeType / toNodeType discriminator columns
//   Gap #9      previous SELLER release scoped to THIS sub-order's items
//   Gap #10     seller variant fallback parity (OR variantId=NULL)
//   Gap #16     reassignmentSequence + SubOrder.reassignmentCount
//   Gap #19     `force: true` admits ACCEPTED+UNFULFILLED
//   Gap #21     ONE AllocationLog per reassignment
//
// The CAS / FOR-UPDATE / outbox-tx behaviours are integration-level and
// covered by the regression suite (their wiring is exercised via the
// transaction body). Here we exercise the unit-level branches.

import { OrdersService } from './orders.service';
import { BadRequestAppException, ConflictAppException } from '../../../../core/exceptions';

type Mock = jest.Mock;

interface FakeTx {
  subOrder: { findUnique: Mock; update: Mock };
  sellerProductMapping: { findFirst: Mock; update: Mock };
  productVariant: { update: Mock };
  product: { update: Mock };
  stockReservation: { create: Mock; findMany: Mock };
  orderReassignmentLog: { count: Mock; create: Mock };
  masterOrder: { update: Mock };
  allocationLog: { create: Mock };
  $queryRaw: Mock;
}

function makeTx(overrides?: Partial<FakeTx>): FakeTx {
  return {
    subOrder: {
      findUnique: jest.fn().mockResolvedValue({
        sellerId: 'seller-old',
        franchiseId: null,
        fulfillmentNodeType: 'SELLER',
        acceptStatus: 'OPEN',
        fulfillmentStatus: 'UNFULFILLED',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    sellerProductMapping: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'map-new-1',
        sellerId: 'seller-new',
        productId: 'p-1',
        variantId: null,
        stockQty: 100,
        reservedQty: 0,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    productVariant: { update: jest.fn() },
    product: { update: jest.fn() },
    stockReservation: {
      create: jest.fn().mockResolvedValue({ id: 'res-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    orderReassignmentLog: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    masterOrder: { update: jest.fn() },
    allocationLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([
      { id: 'map-new-1', stock_qty: 100, reserved_qty: 0 },
    ]),
    ...overrides,
  };
}

function makeService(opts?: {
  subOrder?: any;
  newSeller?: any;
  sellerMapping?: any;
  txOverrides?: Partial<FakeTx>;
  txExec?: (cb: (tx: FakeTx) => Promise<any>) => Promise<any>;
}) {
  const subOrder = opts?.subOrder ?? {
    id: 'sub-1',
    masterOrder: { id: 'master-1', orderNumber: 'ORD-1', orderStatus: 'ROUTED_TO_SELLER' },
    sellerId: 'seller-old',
    franchiseId: null,
    fulfillmentNodeType: 'SELLER',
    acceptStatus: 'OPEN',
    fulfillmentStatus: 'UNFULFILLED',
    items: [{ productId: 'p-1', variantId: null, quantity: 2 }],
  };

  const orderRepo: any = {
    findSubOrderByIdWithItems: jest.fn().mockResolvedValue(subOrder),
    findSeller: jest.fn().mockResolvedValue(
      opts?.newSeller ?? { id: 'seller-new', status: 'ACTIVE', sellerName: 'New', sellerShopName: 'New Shop' },
    ),
    findSellerProductMapping: jest.fn().mockResolvedValue(
      opts?.sellerMapping ?? {
        id: 'map-new-1',
        sellerId: 'seller-new',
        productId: 'p-1',
        variantId: null,
        stockQty: 100,
        reservedQty: 0,
      },
    ),
    executeTransaction: opts?.txExec ?? (async (cb: any) => {
      const tx = makeTx(opts?.txOverrides);
      return cb(tx as any);
    }),
    createReassignmentLog: jest.fn(),
  };

  const prisma: any = {
    sellerProductMapping: {
      findFirst: jest.fn().mockResolvedValue(
        opts?.sellerMapping ?? {
          id: 'map-new-1',
          sellerId: 'seller-new',
          productId: 'p-1',
          variantId: null,
          stockQty: 100,
          reservedQty: 0,
        },
      ),
    },
    franchisePartner: { findUnique: jest.fn() },
    franchiseCatalogMapping: { findFirst: jest.fn() },
    franchiseStock: { findFirst: jest.fn() },
  };

  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const franchiseFacade: any = {
    reserveStock: jest.fn(),
    unreserveStock: jest.fn(),
  };
  const stockRestore: any = {
    restoreForSubOrderItems: jest.fn().mockResolvedValue({ releasedCount: 1 }),
    restoreForOrder: jest.fn(),
    restoreForReservation: jest.fn(),
  };
  const catalogFacade: any = {};
  const taxFacade: any = {};
  const env: any = { getNumber: (_: string, d: number) => d };

  const svc = new OrdersService(
    orderRepo,
    eventBus,
    catalogFacade,
    franchiseFacade,
    prisma,
    stockRestore,
    env,
    taxFacade,
  );

  return { svc, orderRepo, prisma, eventBus, franchiseFacade, stockRestore };
}

describe('OrdersService.reassignSubOrder (Phase 78)', () => {
  describe('Gap #1/#4 — reason required', () => {
    it('rejects when reason missing', async () => {
      const { svc } = makeService();
      await expect(
        svc.reassignSubOrder('sub-1', { nodeType: 'SELLER', nodeId: 'seller-new' }, ''),
      ).rejects.toThrow(/reason is required/);
    });

    it('rejects when reason under 10 chars', async () => {
      const { svc } = makeService();
      await expect(
        svc.reassignSubOrder('sub-1', { nodeType: 'SELLER', nodeId: 'seller-new' }, 'short'),
      ).rejects.toThrow(/minimum 10 characters/);
    });

    it('rejects when reason is whitespace only', async () => {
      const { svc } = makeService();
      await expect(
        svc.reassignSubOrder('sub-1', { nodeType: 'SELLER', nodeId: 'seller-new' }, '          '),
      ).rejects.toThrow(/reason is required/);
    });
  });

  describe('Gap #5/#8/#22 — log row carries actor + node types', () => {
    it('writes reassignedBy + fromNodeType + toNodeType into the log', async () => {
      let logArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx = makeTx({
            orderReassignmentLog: {
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn().mockImplementation((args: any) => {
                logArgs = args.data;
                return Promise.resolve({});
              }),
            } as any,
          });
          await cb(tx);
        },
      });
      await svc.reassignSubOrder(
        'sub-1',
        { nodeType: 'SELLER', nodeId: 'seller-new' },
        'Seller went offline for the day',
        'admin-42',
      );
      expect(logArgs).not.toBeNull();
      expect(logArgs.reassignedBy).toBe('admin-42');
      expect(logArgs.fromNodeType).toBe('SELLER');
      expect(logArgs.toNodeType).toBe('SELLER');
      expect(logArgs.fromNodeId).toBe('seller-old');
      expect(logArgs.toNodeId).toBe('seller-new');
      expect(logArgs.successful).toBe(true);
      expect(logArgs.reason).toBe('Seller went offline for the day');
    });

    it('null reassignedBy when no admin id is provided (programmatic caller)', async () => {
      let logArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx = makeTx({
            orderReassignmentLog: {
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn().mockImplementation((args: any) => {
                logArgs = args.data;
                return Promise.resolve({});
              }),
            } as any,
          });
          await cb(tx);
        },
      });
      await svc.reassignSubOrder(
        'sub-1',
        { nodeType: 'SELLER', nodeId: 'seller-new' },
        'Programmatic reroute test path',
      );
      expect(logArgs.reassignedBy).toBeNull();
    });
  });

  describe('Gap #9 — previous-seller release is sub-order-scoped', () => {
    it('uses restoreForSubOrderItems (not restoreForOrder)', async () => {
      const { svc, stockRestore } = makeService();
      await svc.reassignSubOrder(
        'sub-1',
        { nodeType: 'SELLER', nodeId: 'seller-new' },
        'Routing optimization for distance',
        'admin-1',
      );
      expect(stockRestore.restoreForSubOrderItems).toHaveBeenCalledWith(
        expect.anything(),
        'master-1',
        'seller-old',
        [{ productId: 'p-1', variantId: null }],
      );
      // Critically, the old over-releasing path is NOT used.
      expect(stockRestore.restoreForOrder).not.toHaveBeenCalled();
    });
  });

  describe('Gap #10 — seller variant fallback parity', () => {
    it('builds OR clause for variant-or-null mapping lookup on validation', async () => {
      const { svc, prisma } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrder: { id: 'master-1', orderNumber: 'ORD-1', orderStatus: 'ROUTED_TO_SELLER' },
          sellerId: 'seller-old',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptStatus: 'OPEN',
          fulfillmentStatus: 'UNFULFILLED',
          items: [{ productId: 'p-1', variantId: 'v-1', quantity: 1 }],
        },
      });
      await svc.reassignSubOrder(
        'sub-1',
        { nodeType: 'SELLER', nodeId: 'seller-new' },
        'Test variant fallback parity',
        'admin-1',
      );
      const where = prisma.sellerProductMapping.findFirst.mock.calls[0]![0].where;
      expect(where.OR).toEqual([
        { variantId: 'v-1' },
        { variantId: null },
      ]);
    });
  });

  describe('Gap #16 — reassignment sequence + count', () => {
    it('writes sequence = priorCount + 1 to log', async () => {
      let logArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx = makeTx({
            orderReassignmentLog: {
              count: jest.fn().mockResolvedValue(2),
              create: jest.fn().mockImplementation((args: any) => {
                logArgs = args.data;
                return Promise.resolve({});
              }),
            } as any,
          });
          await cb(tx);
        },
      });
      await svc.reassignSubOrder(
        'sub-1',
        { nodeType: 'SELLER', nodeId: 'seller-new' },
        'Third reassignment in a row',
        'admin-1',
      );
      expect(logArgs.reassignmentSequence).toBe(3);
    });

    it('increments SubOrder.reassignmentCount + sets lastReassignedAt on update', async () => {
      let subUpdateArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx = makeTx({
            subOrder: {
              findUnique: jest.fn().mockResolvedValue({
                sellerId: 'seller-old',
                franchiseId: null,
                fulfillmentNodeType: 'SELLER',
                acceptStatus: 'OPEN',
                fulfillmentStatus: 'UNFULFILLED',
              }),
              update: jest.fn().mockImplementation((args: any) => {
                subUpdateArgs = args.data;
                return Promise.resolve({});
              }),
            } as any,
          });
          await cb(tx);
        },
      });
      await svc.reassignSubOrder(
        'sub-1',
        { nodeType: 'SELLER', nodeId: 'seller-new' },
        'Reassign for visibility counter test',
        'admin-1',
      );
      expect(subUpdateArgs.reassignmentCount).toEqual({ increment: 1 });
      expect(subUpdateArgs.lastReassignedAt).toBeInstanceOf(Date);
    });
  });

  describe('Gap #19 — force=true admits ACCEPTED+UNFULFILLED', () => {
    it('rejects ACCEPTED without force', async () => {
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrder: { id: 'master-1', orderNumber: 'ORD-1', orderStatus: 'ROUTED_TO_SELLER' },
          sellerId: 'seller-old',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptStatus: 'ACCEPTED',
          fulfillmentStatus: 'UNFULFILLED',
          items: [{ productId: 'p-1', variantId: null, quantity: 1 }],
        },
      });
      await expect(
        svc.reassignSubOrder(
          'sub-1',
          { nodeType: 'SELLER', nodeId: 'seller-new' },
          'Manual override needed urgently',
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestAppException);
    });

    it('allows ACCEPTED+UNFULFILLED with force=true', async () => {
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrder: { id: 'master-1', orderNumber: 'ORD-1', orderStatus: 'ROUTED_TO_SELLER' },
          sellerId: 'seller-old',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptStatus: 'ACCEPTED',
          fulfillmentStatus: 'UNFULFILLED',
          items: [{ productId: 'p-1', variantId: null, quantity: 1 }],
        },
        txExec: async (cb) => {
          const tx = makeTx({
            subOrder: {
              findUnique: jest.fn().mockResolvedValue({
                sellerId: 'seller-old',
                franchiseId: null,
                fulfillmentNodeType: 'SELLER',
                acceptStatus: 'ACCEPTED',
                fulfillmentStatus: 'UNFULFILLED',
              }),
              update: jest.fn().mockResolvedValue({}),
            } as any,
          });
          await cb(tx);
        },
      });
      // Should NOT throw with force=true.
      await svc.reassignSubOrder(
        'sub-1',
        { nodeType: 'SELLER', nodeId: 'seller-new' },
        'Forced reassign due to seller-offline',
        'admin-1',
        { force: true },
      );
    });

    it('still rejects ACCEPTED+PACKED with force=true (post-prep is too late)', async () => {
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrder: { id: 'master-1', orderNumber: 'ORD-1', orderStatus: 'ROUTED_TO_SELLER' },
          sellerId: 'seller-old',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptStatus: 'ACCEPTED',
          fulfillmentStatus: 'PACKED',
          items: [{ productId: 'p-1', variantId: null, quantity: 1 }],
        },
      });
      await expect(
        svc.reassignSubOrder(
          'sub-1',
          { nodeType: 'SELLER', nodeId: 'seller-new' },
          'Force after packing should still fail',
          'admin-1',
          { force: true },
        ),
      ).rejects.toThrow(BadRequestAppException);
    });
  });

  describe('Gap #21 — single AllocationLog per reassignment', () => {
    it('writes ONE AllocationLog row even with multi-item sub-order', async () => {
      const allocationCreate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrder: { id: 'master-1', orderNumber: 'ORD-1', orderStatus: 'ROUTED_TO_SELLER' },
          sellerId: 'seller-old',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          acceptStatus: 'OPEN',
          fulfillmentStatus: 'UNFULFILLED',
          items: [
            { productId: 'p-1', variantId: null, quantity: 2 },
            { productId: 'p-2', variantId: 'v-2', quantity: 1 },
            { productId: 'p-3', variantId: null, quantity: 4 },
          ],
        },
        txExec: async (cb) => {
          const tx = makeTx({
            allocationLog: { create: allocationCreate } as any,
          });
          await cb(tx);
        },
      });
      await svc.reassignSubOrder(
        'sub-1',
        { nodeType: 'SELLER', nodeId: 'seller-new' },
        'Multi-item reassignment unit test',
        'admin-1',
      );
      expect(allocationCreate).toHaveBeenCalledTimes(1);
      // Reason text encodes the full item list for forensic queries.
      const reason = allocationCreate.mock.calls[0]![0].data.allocationReason;
      expect(reason).toContain('p-1');
      expect(reason).toContain('p-2/v-2×1');
      expect(reason).toContain('p-3');
    });
  });

  describe('R1 — concurrent reassignment race', () => {
    it('throws ConflictAppException when sub-order was reassigned by another admin between snapshot and CAS', async () => {
      const { svc } = makeService({
        txExec: async (cb) => {
          // Inside the tx, the sub-order has already been reassigned
          // away — its sellerId no longer matches the snapshot.
          const tx = makeTx({
            subOrder: {
              findUnique: jest.fn().mockResolvedValue({
                sellerId: 'seller-other', // ← raced
                franchiseId: null,
                fulfillmentNodeType: 'SELLER',
                acceptStatus: 'OPEN',
                fulfillmentStatus: 'UNFULFILLED',
              }),
              update: jest.fn(),
            } as any,
          });
          await cb(tx);
        },
      });
      await expect(
        svc.reassignSubOrder(
          'sub-1',
          { nodeType: 'SELLER', nodeId: 'seller-new' },
          'Race-loser admin should see conflict',
          'admin-1',
        ),
      ).rejects.toThrow(ConflictAppException);
    });
  });
});
