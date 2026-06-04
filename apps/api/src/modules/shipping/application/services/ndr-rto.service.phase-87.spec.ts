// Phase 87 (2026-05-23) — NdrRtoService coverage.
//
// Replaces the 1-line `UndrUrtoService {}` stub. Covers:
//   Gap #1  — service exists with real methods
//   Gap #14 — handleNdrAction routes to carrier adapter
//   Gap #15 — gateway.reattempt + gateway.initiateRto are called
//   Gap #18 — autoInitiateRtoForExhaustedNdr writes RtoEvent + emits
//   Gap #24 — forceInitiateRto delegates to the admin-cancel terminal
//
// Phase 89 (2026-06-02) — forceInitiateRto now delegates the financial
// terminal (refund/stock/status/master-rollup/AWB-cancel) to
// OrdersService.adminCancelSubOrder({ force: true }) instead of only
// stamping rtoInitiatedAt + emitting RTO_INITIATED (which left the order
// stuck SHIPPED with no refund). The constructor therefore takes a 4th
// dependency (OrdersService), and the force-RTO assertions below check the
// delegation + the RTO audit row rather than the old event/carrier calls.

import { NdrRtoService } from './ndr-rto.service';
import { SHIPPING_EVENTS } from '../../domain/events/shipping.events';

function buildPrisma(overrides: any = {}) {
  return {
    subOrder: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      ...overrides.subOrder,
    },
    rtoEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation(async (fn: any) => {
      const tx = {
        subOrder: { update: jest.fn().mockResolvedValue({}) },
        rtoEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    }),
    ...overrides,
  };
}

function buildEventBus() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildResolver(gateway: any) {
  return { forMethod: jest.fn().mockReturnValue(gateway) };
}

// Phase 89 — OrdersService dependency. adminCancelSubOrder is the terminal
// forceInitiateRto delegates to; default resolves (cancel succeeded).
function buildOrders(overrides: any = {}) {
  return {
    adminCancelSubOrder: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('NdrRtoService (Phase 87)', () => {
  describe('handleNdrAction', () => {
    it('throws on missing sub-order', async () => {
      const prisma = buildPrisma();
      const svc = new NdrRtoService(prisma as any, buildEventBus() as any, buildResolver({}) as any, buildOrders() as any);
      await expect(
        svc.handleNdrAction({
          subOrderId: 'missing',
          action: 'REATTEMPT',
          actorId: 'u',
          actorType: 'CUSTOMER',
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('refuses to act on a sub-order already in RTO', async () => {
      const prisma = buildPrisma({
        subOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sub-1',
            trackingNumber: 'AWB1',
            deliveryMethod: 'SELF_DELIVERY',
            courierName: 'Shiprocket',
            ndrAttemptCount: 1,
            ndrStatus: 'EXHAUSTED',
            rtoInitiatedAt: new Date(),
            fulfillmentStatus: 'SHIPPED',
          }),
        },
      });
      const svc = new NdrRtoService(prisma as any, buildEventBus() as any, buildResolver({}) as any, buildOrders() as any);
      await expect(
        svc.handleNdrAction({
          subOrderId: 'sub-1',
          action: 'REATTEMPT',
          actorId: 'u',
          actorType: 'CUSTOMER',
        }),
      ).rejects.toThrow(/already in RTO/i);
    });

    it('CONVERT_TO_RTO calls gateway.initiateRto + marks resolved', async () => {
      const initiateRto = jest.fn().mockResolvedValue({});
      const prisma = buildPrisma({
        subOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sub-1',
            trackingNumber: 'AWB1',
            deliveryMethod: 'SELF_DELIVERY',
            courierName: 'Shiprocket',
            ndrAttemptCount: 2,
            ndrStatus: 'PENDING_REATTEMPT',
            rtoInitiatedAt: null,
            fulfillmentStatus: 'SHIPPED',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const svc = new NdrRtoService(
        prisma as any,
        buildEventBus() as any,
        buildResolver({ initiateRto }) as any,
        buildOrders() as any,
      );
      const res = await svc.handleNdrAction({
        subOrderId: 'sub-1',
        action: 'CONVERT_TO_RTO',
        actorId: 'u',
        actorType: 'CUSTOMER',
        reason: 'address wrong',
      });
      expect(res.outcome).toBe('OK');
      expect(initiateRto).toHaveBeenCalledWith(
        expect.objectContaining({ awb: 'AWB1', remark: 'address wrong' }),
      );
      expect(prisma.subOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ndrStatus: 'EXHAUSTED' } }),
      );
    });

    it('REATTEMPT calls gateway.reattempt', async () => {
      const reattempt = jest.fn().mockResolvedValue({});
      const prisma = buildPrisma({
        subOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sub-1',
            trackingNumber: 'AWB1',
            deliveryMethod: 'SELF_DELIVERY',
            courierName: 'Shiprocket',
            ndrAttemptCount: 1,
            ndrStatus: 'PENDING_REATTEMPT',
            rtoInitiatedAt: null,
            fulfillmentStatus: 'SHIPPED',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const svc = new NdrRtoService(
        prisma as any,
        buildEventBus() as any,
        buildResolver({ reattempt }) as any,
        buildOrders() as any,
      );
      const res = await svc.handleNdrAction({
        subOrderId: 'sub-1',
        action: 'REATTEMPT',
        actorId: 'u',
        actorType: 'CUSTOMER',
      });
      expect(res.outcome).toBe('OK');
      expect(reattempt).toHaveBeenCalledWith(
        expect.objectContaining({ awb: 'AWB1' }),
      );
    });

    it('publishes NDR_RESOLVED event on success', async () => {
      const eventBus = buildEventBus();
      const prisma = buildPrisma({
        subOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sub-1',
            trackingNumber: 'AWB1',
            deliveryMethod: 'SELF_DELIVERY',
            courierName: 'Shiprocket',
            ndrAttemptCount: 1,
            ndrStatus: 'PENDING_REATTEMPT',
            rtoInitiatedAt: null,
            fulfillmentStatus: 'SHIPPED',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const svc = new NdrRtoService(
        prisma as any,
        eventBus as any,
        buildResolver({ reattempt: jest.fn() }) as any,
        buildOrders() as any,
      );
      await svc.handleNdrAction({
        subOrderId: 'sub-1',
        action: 'REATTEMPT',
        actorId: 'u',
        actorType: 'CUSTOMER',
      });
      const names = eventBus.publish.mock.calls.map((c) => c[0].eventName);
      expect(names).toContain(SHIPPING_EVENTS.NDR_RESOLVED);
    });
  });

  describe('forceInitiateRto', () => {
    it('delegates the terminal to adminCancelSubOrder(force) + writes the RTO audit row', async () => {
      const txSubUpdate = jest.fn().mockResolvedValue({});
      const txRtoCreate = jest.fn().mockResolvedValue({});
      const eventBus = buildEventBus();
      const orders = buildOrders();
      const prisma: any = {
        subOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sub-1',
            trackingNumber: 'AWB1',
            deliveryMethod: 'SELF_DELIVERY',
            rtoInitiatedAt: null,
            fulfillmentStatus: 'SHIPPED',
          }),
        },
        $transaction: jest.fn().mockImplementation(async (fn: any) => {
          return fn({
            subOrder: { update: txSubUpdate },
            rtoEvent: { create: txRtoCreate },
          });
        }),
      };
      const svc = new NdrRtoService(
        prisma,
        eventBus as any,
        buildResolver({ initiateRto: jest.fn() }) as any,
        orders as any,
      );
      await svc.forceInitiateRto({
        subOrderId: 'sub-1',
        reason: 'High fraud risk',
        adminId: 'admin-7',
      });
      // Phase 89 — the financial terminal is delegated to the admin-cancel
      // path with force=true (refund + stock + master rollup + AWB cancel).
      expect(orders.adminCancelSubOrder).toHaveBeenCalledWith(
        'sub-1',
        'admin-7',
        'High fraud risk',
        { force: true },
      );
      // RTO audit row still written (drives the NDR/RTO panel).
      expect(txSubUpdate).toHaveBeenCalled();
      expect(txRtoCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RTO_INITIATED',
            reason: 'High fraud risk',
          }),
        }),
      );
    });

    it('refuses to force RTO on a delivered sub-order', async () => {
      const prisma: any = {
        subOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sub-1',
            trackingNumber: 'AWB1',
            deliveryMethod: 'SELF_DELIVERY',
            rtoInitiatedAt: null,
            fulfillmentStatus: 'DELIVERED',
          }),
        },
        $transaction: jest.fn(),
      };
      const orders = buildOrders();
      const svc = new NdrRtoService(
        prisma,
        buildEventBus() as any,
        buildResolver({ initiateRto: jest.fn() }) as any,
        orders as any,
      );
      await expect(
        svc.forceInitiateRto({
          subOrderId: 'sub-1',
          reason: 'test reason here',
          adminId: 'admin-1',
        }),
      ).rejects.toThrow(/delivered/i);
      // Must not have touched the order when the guard rejects.
      expect(orders.adminCancelSubOrder).not.toHaveBeenCalled();
    });
  });

  describe('autoInitiateRtoForExhaustedNdr', () => {
    it('writes RtoEvent + emits RTO_INITIATED with AUTO_THRESHOLD source', async () => {
      const txSubUpdate = jest.fn().mockResolvedValue({});
      const txRtoCreate = jest.fn().mockResolvedValue({});
      const eventBus = buildEventBus();
      const prisma: any = {
        subOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sub-1',
            trackingNumber: 'AWB1',
            deliveryMethod: 'SELF_DELIVERY',
            rtoInitiatedAt: null,
          }),
        },
        $transaction: jest.fn().mockImplementation(async (fn: any) => {
          return fn({
            subOrder: { update: txSubUpdate },
            rtoEvent: { create: txRtoCreate },
          });
        }),
      };
      const svc = new NdrRtoService(
        prisma,
        eventBus as any,
        buildResolver({}) as any,
        buildOrders() as any,
      );
      await svc.autoInitiateRtoForExhaustedNdr({
        subOrderId: 'sub-1',
        attemptCount: 3,
        threshold: 3,
      });
      const rtoEvent = eventBus.publish.mock.calls.find(
        (c) => c[0].eventName === SHIPPING_EVENTS.RTO_INITIATED,
      );
      expect(rtoEvent![0].payload.source).toBe('AUTO_THRESHOLD');
      expect(rtoEvent![0].payload.attemptCount).toBe(3);
    });

    it('is a no-op when the sub-order is already in RTO', async () => {
      const eventBus = buildEventBus();
      const prisma: any = {
        subOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sub-1',
            trackingNumber: 'AWB1',
            deliveryMethod: 'SELF_DELIVERY',
            rtoInitiatedAt: new Date(),
          }),
        },
        $transaction: jest.fn(),
      };
      const svc = new NdrRtoService(
        prisma,
        eventBus as any,
        buildResolver({}) as any,
        buildOrders() as any,
      );
      await svc.autoInitiateRtoForExhaustedNdr({
        subOrderId: 'sub-1',
        attemptCount: 3,
        threshold: 3,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
