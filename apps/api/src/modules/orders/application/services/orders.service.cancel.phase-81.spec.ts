// Phase 81 (2026-05-22) — sub-order cancel hardening.
//
// Covers the audit gaps closed in OrdersService.adminCancelSubOrder:
//   Gap #1     — refund saga fires for prepaid (PAID + ONLINE); COD skipped
//   Gap #2/#3  — cancelledAt / cancelledBy / cancelReason / cancellationSource persisted
//   Gap #4     — audit_log row written
//   Gap #5     — sub-order-scoped stock release (via restoreForSubOrderItems)
//   Gap #6/#20 — master order status flips to PARTIALLY_CANCELLED or CANCELLED
//   Gap #8     — SHIPPED/FULFILLED requires force flag
//   Gap #9     — single tx wraps stock release + status flip + audit log + event
//   Gap #11    — reason required (10+ chars)
//   Gap #15    — commissionDecision flipped to NOT_APPLICABLE
//   Gap #22    — FOR UPDATE row lock + inside-tx re-check (race close)

import { OrdersService } from './orders.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

interface FakeTx {
  $queryRaw: jest.Mock;
  subOrder: { update: jest.Mock; findMany: jest.Mock };
  masterOrder: { update: jest.Mock };
}

function makeService(opts?: {
  subOrder?: any;
  master?: any;
  siblings?: any[];
  txLockedRow?: any;
  txExec?: (cb: (tx: FakeTx) => Promise<any>) => Promise<any>;
}) {
  const subOrder = opts?.subOrder ?? {
    id: 'sub-1',
    masterOrder: { id: 'master-1', orderNumber: 'ORD-1' },
    sellerId: 'seller-1',
    franchiseId: null,
    fulfillmentNodeType: 'SELLER',
    fulfillmentStatus: 'UNFULFILLED',
    acceptStatus: 'OPEN',
    subTotalInPaise: 50_000n,
    items: [
      { productId: 'p-1', variantId: null, quantity: 2 },
      { productId: 'p-2', variantId: 'v-2', quantity: 1 },
    ],
  };

  const master = opts?.master ?? {
    id: 'master-1',
    orderNumber: 'ORD-1',
    customerId: 'customer-1',
    paymentStatus: 'PAID',
    paymentMethod: 'ONLINE',
    totalAmountInPaise: 150_000n,
    orderStatus: 'ROUTED_TO_SELLER',
  };

  const siblings = opts?.siblings ?? [
    { id: 'sub-1', fulfillmentStatus: 'CANCELLED', acceptStatus: 'CANCELLED' },
    { id: 'sub-2', fulfillmentStatus: 'UNFULFILLED', acceptStatus: 'OPEN' },
  ];

  const lockedRow = opts?.txLockedRow ?? {
    id: subOrder.id,
    fulfillment_status: subOrder.fulfillmentStatus,
    accept_status: subOrder.acceptStatus,
  };

  const orderRepo: any = {
    findSubOrderByIdWithItems: jest.fn().mockResolvedValue(subOrder),
    executeTransaction: opts?.txExec ?? (async (cb: any) => {
      const tx: FakeTx = {
        $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
        subOrder: {
          update: jest.fn().mockResolvedValue({
            id: subOrder.id,
            fulfillmentStatus: 'CANCELLED',
            acceptStatus: 'CANCELLED',
          }),
          findMany: jest.fn().mockResolvedValue(siblings),
        },
        masterOrder: { update: jest.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    }),
  };

  const prisma: any = {
    masterOrder: { findUnique: jest.fn().mockResolvedValue(master) },
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const franchiseFacade: any = { unreserveStock: jest.fn().mockResolvedValue(undefined) };
  const stockRestore: any = {
    restoreForSubOrderItems: jest.fn().mockResolvedValue({ releasedCount: 1 }),
    restoreForOrder: jest.fn(),
  };
  const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const refundInstructions: any = {
    createSplitForRefund: jest.fn().mockResolvedValue([{ id: 'refund-1' }]),
  };
  const taxFacade: any = {};
  const env: any = { getNumber: (_: string, d: number) => d };

  const svc = new OrdersService(
    orderRepo,
    eventBus,
    {} as any,
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
    orderRepo,
    prisma,
    eventBus,
    franchiseFacade,
    stockRestore,
    auditFacade,
    refundInstructions,
  };
}

describe('OrdersService.adminCancelSubOrder (Phase 81)', () => {
  describe('Gap #11 — reason required', () => {
    it('rejects when reason missing', async () => {
      const { svc } = makeService();
      await expect(
        svc.adminCancelSubOrder('sub-1', 'admin-1', ''),
      ).rejects.toThrow(BadRequestAppException);
    });

    it('rejects when reason under 10 chars', async () => {
      const { svc } = makeService();
      await expect(
        svc.adminCancelSubOrder('sub-1', 'admin-1', 'short'),
      ).rejects.toThrow(/minimum 10 characters/);
    });

    it('rejects whitespace-only reason', async () => {
      const { svc } = makeService();
      await expect(
        svc.adminCancelSubOrder('sub-1', 'admin-1', '          '),
      ).rejects.toThrow(/reason is required/);
    });
  });

  describe('Gap #8 — SHIPPED requires force', () => {
    it('rejects SHIPPED cancel without force', async () => {
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrder: { id: 'master-1', orderNumber: 'ORD-1' },
          sellerId: 'seller-1',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          fulfillmentStatus: 'SHIPPED',
          acceptStatus: 'ACCEPTED',
          subTotalInPaise: 50_000n,
          items: [{ productId: 'p-1', variantId: null, quantity: 1 }],
        },
      });
      await expect(
        svc.adminCancelSubOrder('sub-1', 'admin-1', 'Customer changed mind'),
      ).rejects.toThrow(/force=true/);
    });

    it('allows SHIPPED cancel with force=true', async () => {
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrder: { id: 'master-1', orderNumber: 'ORD-1' },
          sellerId: 'seller-1',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          fulfillmentStatus: 'SHIPPED',
          acceptStatus: 'ACCEPTED',
          subTotalInPaise: 50_000n,
          items: [{ productId: 'p-1', variantId: null, quantity: 1 }],
        },
        txLockedRow: {
          id: 'sub-1',
          fulfillment_status: 'SHIPPED',
          accept_status: 'ACCEPTED',
        },
      });
      await expect(
        svc.adminCancelSubOrder(
          'sub-1',
          'admin-1',
          'Courier failed pickup — refund customer',
          { force: true },
        ),
      ).resolves.toBeDefined();
    });

    it('still blocks DELIVERED with force', async () => {
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrder: { id: 'master-1', orderNumber: 'ORD-1' },
          sellerId: 'seller-1',
          franchiseId: null,
          fulfillmentNodeType: 'SELLER',
          fulfillmentStatus: 'DELIVERED',
          acceptStatus: 'ACCEPTED',
          subTotalInPaise: 50_000n,
          items: [{ productId: 'p-1', variantId: null, quantity: 1 }],
        },
      });
      await expect(
        svc.adminCancelSubOrder(
          'sub-1',
          'admin-1',
          'Goods returned in person',
          { force: true },
        ),
      ).rejects.toThrow(/DELIVERED/);
    });
  });

  describe('Gap #2/#3 — cancellation audit columns persisted', () => {
    it('writes cancelledAt + cancelledBy + cancelReason + cancellationSource', async () => {
      let updateArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              {
                id: 'sub-1',
                fulfillment_status: 'UNFULFILLED',
                accept_status: 'OPEN',
              },
            ]),
            subOrder: {
              update: jest.fn().mockImplementation((args: any) => {
                updateArgs = args.data;
                return Promise.resolve({ id: 'sub-1' });
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'CANCELLED', acceptStatus: 'CANCELLED' },
              ]),
            },
            masterOrder: { update: jest.fn().mockResolvedValue({}) },
          };
          return cb(tx);
        },
      });
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-42',
        'Customer requested refund after delay',
      );
      expect(updateArgs.cancelledBy).toBe('admin-42');
      expect(updateArgs.cancelReason).toBe('Customer requested refund after delay');
      expect(updateArgs.cancellationSource).toBe('ADMIN');
      expect(updateArgs.cancelledAt).toBeInstanceOf(Date);
    });
  });

  describe('Gap #15 — commissionDecision = NOT_APPLICABLE', () => {
    it('flips commissionDecision so settlement skips this sub-order', async () => {
      let updateArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'UNFULFILLED', accept_status: 'OPEN' },
            ]),
            subOrder: {
              update: jest.fn().mockImplementation((args: any) => {
                updateArgs = args.data;
                return Promise.resolve({ id: 'sub-1' });
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'CANCELLED', acceptStatus: 'CANCELLED' },
              ]),
            },
            masterOrder: { update: jest.fn() },
          };
          return cb(tx);
        },
      });
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-1',
        'Stock unavailability at seller',
      );
      expect(updateArgs.commissionDecision).toBe('NOT_APPLICABLE');
    });
  });

  describe('Gap #5 — sub-order-scoped stock release (no over-release)', () => {
    it('uses restoreForSubOrderItems (NOT restoreForOrder) with the items array', async () => {
      const { svc, stockRestore } = makeService();
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-1',
        'Stock recovery for sister sub-orders',
      );
      expect(stockRestore.restoreForSubOrderItems).toHaveBeenCalledWith(
        expect.anything(),
        'master-1',
        'seller-1',
        [
          { productId: 'p-1', variantId: null },
          { productId: 'p-2', variantId: 'v-2' },
        ],
      );
      // Pre-Phase-81 over-releasing path is NOT used.
      expect(stockRestore.restoreForOrder).not.toHaveBeenCalled();
    });
  });

  describe('Gap #6/#20 — master order status recompute', () => {
    it('flips master to PARTIALLY_CANCELLED when only this sub-order is cancelled', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        siblings: [
          { id: 'sub-1', fulfillmentStatus: 'CANCELLED', acceptStatus: 'CANCELLED' },
          { id: 'sub-2', fulfillmentStatus: 'UNFULFILLED', acceptStatus: 'OPEN' },
        ],
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'UNFULFILLED', accept_status: 'OPEN' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'CANCELLED', acceptStatus: 'CANCELLED' },
                { id: 'sub-2', fulfillmentStatus: 'UNFULFILLED', acceptStatus: 'OPEN' },
              ]),
            },
            masterOrder: { update: masterUpdate },
          };
          return cb(tx);
        },
      });
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-1',
        'Partial cancellation for partial-cancel branch test',
      );
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orderStatus: 'PARTIALLY_CANCELLED' },
        }),
      );
    });

    it('flips master to CANCELLED when ALL sub-orders are cancelled', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'UNFULFILLED', accept_status: 'OPEN' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'CANCELLED', acceptStatus: 'CANCELLED' },
              ]),
            },
            masterOrder: { update: masterUpdate },
          };
          return cb(tx);
        },
      });
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-1',
        'Final sub-order cancel — full master cancel',
      );
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orderStatus: 'CANCELLED' },
        }),
      );
    });
  });

  describe('Gap #4 — audit log row written', () => {
    it('writes audit log with action=SUB_ORDER_CANCELLED', async () => {
      const { svc, auditFacade } = makeService();
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-1',
        'Audit log persistence test',
      );
      expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-1',
          actorRole: 'ADMIN',
          action: 'SUB_ORDER_CANCELLED',
          module: 'orders',
          resource: 'SubOrder',
          resourceId: 'sub-1',
        }),
      );
    });
  });

  describe('Gap #1 — refund saga for prepaid', () => {
    it('fires refund for PAID + ONLINE sub-order', async () => {
      const { svc, refundInstructions } = makeService();
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-1',
        'Prepaid cancel — refund triggered',
      );
      expect(refundInstructions.createSplitForRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: 'sub-1',
          amountInPaise: 50_000n,
          baseIdempotencyKey: 'cancel-sub-order:sub-1',
        }),
      );
    });

    it('skips refund for COD sub-order', async () => {
      const { svc, refundInstructions } = makeService({
        master: {
          id: 'master-1',
          orderNumber: 'ORD-1',
          customerId: 'customer-1',
          paymentStatus: 'PENDING',
          paymentMethod: 'COD',
          totalAmountInPaise: 150_000n,
          orderStatus: 'ROUTED_TO_SELLER',
        },
      });
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-1',
        'COD cancel — no refund needed',
      );
      expect(refundInstructions.createSplitForRefund).not.toHaveBeenCalled();
    });

    it('skips refund when paymentStatus is not PAID even if ONLINE', async () => {
      const { svc, refundInstructions } = makeService({
        master: {
          id: 'master-1',
          orderNumber: 'ORD-1',
          customerId: 'customer-1',
          paymentStatus: 'PENDING',
          paymentMethod: 'ONLINE',
          totalAmountInPaise: 150_000n,
          orderStatus: 'ROUTED_TO_SELLER',
        },
      });
      await svc.adminCancelSubOrder(
        'sub-1',
        'admin-1',
        'Unpaid ONLINE cancel — no refund yet',
      );
      expect(refundInstructions.createSplitForRefund).not.toHaveBeenCalled();
    });
  });

  describe('Gap #22 — concurrent cancel race', () => {
    it('throws ConflictAppException when sub-order was cancelled by another actor between snapshot and lock', async () => {
      const { svc } = makeService({
        txLockedRow: {
          id: 'sub-1',
          fulfillment_status: 'CANCELLED', // raced
          accept_status: 'CANCELLED',
        },
      });
      await expect(
        svc.adminCancelSubOrder(
          'sub-1',
          'admin-1',
          'Race loser sees ConflictAppException',
        ),
      ).rejects.toThrow(ConflictAppException);
    });

    it('uses FOR UPDATE in raw SQL', async () => {
      let queryFragments: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockImplementation((q: any) => {
              queryFragments = q;
              return Promise.resolve([
                { id: 'sub-1', fulfillment_status: 'UNFULFILLED', accept_status: 'OPEN' },
              ]);
            }),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'CANCELLED', acceptStatus: 'CANCELLED' },
              ]),
            },
            masterOrder: { update: jest.fn() },
          };
          return cb(tx);
        },
      });
      await svc.adminCancelSubOrder('sub-1', 'admin-1', 'FOR UPDATE lock test');
      const sql = Array.isArray(queryFragments)
        ? queryFragments.join('?')
        : String(queryFragments);
      expect(sql).toContain('FOR UPDATE');
    });
  });
});
