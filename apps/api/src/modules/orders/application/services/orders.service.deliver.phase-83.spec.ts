// Phase 83 (2026-05-23) — delivery confirmation hardening.
//
// Covers the audit gaps closed in OrdersService.deliverSubOrder:
//   Gap #2     — commissionLockScheduledAt set at delivery time
//   Gap #3     — deliveredBy + deliverySource persisted
//   Gap #4     — single tx wraps stock update + master rollup + audit + event
//   Gap #11    — deliveryProofUrl / deliverySignatureUrl / OTP persisted
//   Gap #12    — audit_log row written
//   Master rollup — PARTIALLY_DELIVERED when some siblings still in transit
//   FSM gate   — FOR UPDATE re-check inside tx
//
// AWB lookup OR(ithinkAwb) is verified at repo level via the live
// `findSubOrderByTrackingNumber` integration (changed in this phase).

import { OrdersService } from './orders.service';
import { BadRequestAppException } from '../../../../core/exceptions';

interface FakeTx {
  $queryRaw: jest.Mock;
  subOrder: { update: jest.Mock; findMany: jest.Mock };
  masterOrder: { findUnique: jest.Mock; update: jest.Mock };
}

function makeService(opts?: {
  subOrder?: any;
  siblings?: any[];
  masterStatus?: string;
  txLockedRow?: any;
  txExec?: (cb: (tx: FakeTx) => Promise<any>) => Promise<any>;
}) {
  const subOrder = opts?.subOrder ?? {
    id: 'sub-1',
    masterOrderId: 'master-1',
    sellerId: 'seller-1',
    fulfillmentStatus: 'SHIPPED',
    acceptStatus: 'ACCEPTED',
    masterOrder: {
      id: 'master-1',
      orderStatus: opts?.masterStatus ?? 'DISPATCHED',
      subOrders: opts?.siblings ?? [
        { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
      ],
    },
  };

  const siblings = opts?.siblings ?? [
    { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
  ];
  const masterStatus = opts?.masterStatus ?? 'DISPATCHED';
  const lockedRow = opts?.txLockedRow ?? {
    id: subOrder.id,
    fulfillment_status: subOrder.fulfillmentStatus,
  };

  const txMock: FakeTx = {
    $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
    subOrder: {
      update: jest.fn().mockResolvedValue({ id: subOrder.id, fulfillmentStatus: 'DELIVERED' }),
      findMany: jest.fn().mockResolvedValue(siblings),
    },
    masterOrder: {
      findUnique: jest.fn().mockResolvedValue({ orderStatus: masterStatus }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const orderRepo: any = {
    findSubOrderByIdWithMasterOrder: jest.fn().mockResolvedValue(subOrder),
    updateSubOrder: jest.fn(),
    updateMasterOrder: jest.fn(),
    executeTransaction: opts?.txExec ?? (async (cb: any) => cb(txMock)),
  };

  const prisma: any = {};
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const env: any = { getNumber: (_: string, d: number) => d };
  const taxFacade: any = {};

  const svc = new OrdersService(
    orderRepo,
    eventBus,
    {} as any,
    {} as any,
    prisma,
    {} as any,
    env,
    taxFacade,
    auditFacade,
  );
  return { svc, orderRepo, eventBus, auditFacade, txMock };
}

describe('OrdersService.deliverSubOrder (Phase 83)', () => {
  describe('Gap #3 — deliveredBy + deliverySource', () => {
    it('persists WEBHOOK_SHIPROCKET source + deliveredBy slug', async () => {
      let updateArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'SHIPPED' },
            ]),
            subOrder: {
              update: jest.fn().mockImplementation((args: any) => {
                updateArgs = args.data;
                return Promise.resolve({ id: 'sub-1' });
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'DISPATCHED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await svc.deliverSubOrder('sub-1', {
        source: 'WEBHOOK_SHIPROCKET',
        deliveredBy: 'shiprocket:AWB12345',
      });
      expect(updateArgs.deliverySource).toBe('WEBHOOK_SHIPROCKET');
      expect(updateArgs.deliveredBy).toBe('shiprocket:AWB12345');
      expect(updateArgs.deliveredAt).toBeInstanceOf(Date);
    });

    it('persists MANUAL_ADMIN source + admin id', async () => {
      let updateArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'SHIPPED' },
            ]),
            subOrder: {
              update: jest.fn().mockImplementation((args: any) => {
                updateArgs = args.data;
                return Promise.resolve({ id: 'sub-1' });
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'DISPATCHED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await svc.deliverSubOrder('sub-1', {
        source: 'MANUAL_ADMIN',
        deliveredBy: 'admin-42',
        deliveryProofUrl: 'https://cdn.example.com/pod.jpg',
        deliveryOtpVerified: true,
      });
      expect(updateArgs.deliverySource).toBe('MANUAL_ADMIN');
      expect(updateArgs.deliveredBy).toBe('admin-42');
      expect(updateArgs.deliveryProofUrl).toBe('https://cdn.example.com/pod.jpg');
      expect(updateArgs.deliveryOtpVerified).toBe(true);
    });

    it('defaults source to MANUAL_ADMIN when not specified', async () => {
      let updateArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'SHIPPED' },
            ]),
            subOrder: {
              update: jest.fn().mockImplementation((args: any) => {
                updateArgs = args.data;
                return Promise.resolve({ id: 'sub-1' });
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'DISPATCHED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await svc.deliverSubOrder('sub-1');
      expect(updateArgs.deliverySource).toBe('MANUAL_ADMIN');
    });
  });

  describe('Gap #2 — commissionLockScheduledAt at delivery time', () => {
    it('writes commissionLockScheduledAt = returnWindowEndsAt', async () => {
      let updateArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'SHIPPED' },
            ]),
            subOrder: {
              update: jest.fn().mockImplementation((args: any) => {
                updateArgs = args.data;
                return Promise.resolve({ id: 'sub-1' });
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'DISPATCHED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await svc.deliverSubOrder('sub-1', { source: 'MANUAL_ADMIN' });
      expect(updateArgs.commissionLockScheduledAt).toBeInstanceOf(Date);
      expect(updateArgs.returnWindowEndsAt).toBeInstanceOf(Date);
      // They should be equal — commission locks the moment return-window closes.
      expect(updateArgs.commissionLockScheduledAt).toEqual(
        updateArgs.returnWindowEndsAt,
      );
    });
  });

  describe('Master rollup', () => {
    it('flips master to DELIVERED when ALL active sub-orders are DELIVERED', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        siblings: [
          { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
          { id: 'sub-2', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
        ],
        masterStatus: 'DISPATCHED',
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'SHIPPED' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
                { id: 'sub-2', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'DISPATCHED' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      await svc.deliverSubOrder('sub-1', { source: 'MANUAL_ADMIN' });
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { orderStatus: 'DELIVERED' } }),
      );
    });

    it('flips master to PARTIALLY_DELIVERED when some siblings still in transit', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        masterStatus: 'DISPATCHED',
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'SHIPPED' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
                { id: 'sub-2', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'DISPATCHED' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      await svc.deliverSubOrder('sub-1', { source: 'WEBHOOK_SHIPROCKET' });
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { orderStatus: 'PARTIALLY_DELIVERED' } }),
      );
    });

    it('ignores REJECTED siblings when computing rollup', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        masterStatus: 'DISPATCHED',
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'SHIPPED' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
                { id: 'sub-rejected', fulfillmentStatus: 'CANCELLED', acceptStatus: 'REJECTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'DISPATCHED' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      await svc.deliverSubOrder('sub-1', { source: 'MANUAL_ADMIN' });
      // Only sub-1 is active and it's DELIVERED → DELIVERED, NOT PARTIALLY_DELIVERED.
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { orderStatus: 'DELIVERED' } }),
      );
    });

    it('leaves master untouched when FSM rejects the transition', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        masterStatus: 'EXCEPTION_QUEUE',
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'SHIPPED' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'DELIVERED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'EXCEPTION_QUEUE' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      // EXCEPTION_QUEUE → DELIVERED is NOT in the FSM transition
      // matrix (admin must resolve the exception state first). The
      // sub-order still gets DELIVERED but master stays untouched.
      await svc.deliverSubOrder('sub-1', { source: 'MANUAL_ADMIN' });
      expect(masterUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Gap #12 — audit log', () => {
    it('writes SUB_ORDER_DELIVERED audit log with actor metadata', async () => {
      const { svc, auditFacade } = makeService();
      await svc.deliverSubOrder('sub-1', {
        source: 'WEBHOOK_SHIPROCKET',
        deliveredBy: 'shiprocket:AWB12345',
      });
      expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'shiprocket:AWB12345',
          actorRole: 'SYSTEM',
          action: 'SUB_ORDER_DELIVERED',
          module: 'orders',
          resource: 'SubOrder',
          resourceId: 'sub-1',
        }),
      );
    });

    it('manual delivery audit log uses actorRole=ADMIN', async () => {
      const { svc, auditFacade } = makeService();
      await svc.deliverSubOrder('sub-1', {
        source: 'MANUAL_ADMIN',
        deliveredBy: 'admin-42',
      });
      expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-42',
          actorRole: 'ADMIN',
        }),
      );
    });
  });

  describe('FSM gates', () => {
    it('rejects delivery when fulfillmentStatus is not SHIPPED', async () => {
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrderId: 'master-1',
          sellerId: 'seller-1',
          fulfillmentStatus: 'UNFULFILLED',
          acceptStatus: 'ACCEPTED',
          masterOrder: { id: 'master-1', orderStatus: 'ROUTED_TO_SELLER', subOrders: [] },
        },
      });
      await expect(
        svc.deliverSubOrder('sub-1', { source: 'MANUAL_ADMIN' }),
      ).rejects.toThrow(BadRequestAppException);
    });
  });

  describe('Outbox event payload', () => {
    it('publishes orders.sub_order.delivered with source + newMasterStatus', async () => {
      const { svc, eventBus } = makeService();
      await svc.deliverSubOrder('sub-1', {
        source: 'WEBHOOK_SHIPROCKET',
        deliveredBy: 'shiprocket:AWB12345',
      });
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'orders.sub_order.delivered',
          payload: expect.objectContaining({
            deliverySource: 'WEBHOOK_SHIPROCKET',
            deliveredBy: 'shiprocket:AWB12345',
            allDelivered: true,
          }),
        }),
        // Phase 83 — outbox-aware: tx threaded through (Gap #16).
        expect.objectContaining({ tx: expect.anything() }),
      );
    });
  });
});
