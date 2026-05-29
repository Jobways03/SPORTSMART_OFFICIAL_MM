// Phase 86 (2026-05-23) — applySnapshot transactional coverage.
//
// Asserts:
//   Gap #1/#17 — ShipmentTrackingEvent row written per accepted scan
//   Gap #3     — FSM rejection returns reason 'FSM_REJECTED'
//   Gap #11    — SubOrder update + tracking event row + event publish
//                run inside a single transaction
//   Gap #13    — SHIPMENT_DELIVERED emitted on DELIVERED
//   Gap #22    — events publish with `{ tx }` (outbox-aware)
//   Gap #27    — SHIPMENT_LOST emitted on LOST and DAMAGED

import { IngestTrackingUpdateUseCase } from './ingest-tracking-update.use-case';
import { ShipmentStateService } from '../services/shipment-state.service';
import { SHIPPING_EVENTS } from '../../domain/events/shipping.events';
import type { TrackingSnapshot } from '../ports/outbound/courier-gateway.port';

type TxMock = {
  shipmentTrackingEvent: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  subOrder: {
    update: jest.Mock;
    findUnique: jest.Mock;
  };
  // Phase 87 — NDR/RTO history tables mocked alongside the existing
  // tracking-event tx writes.
  ndrAttempt: { create: jest.Mock };
  rtoEvent: { create: jest.Mock };
  rtoCreditNotePending: { create: jest.Mock };
  subOrderTaxSummary: { findFirst: jest.Mock };
};

function buildPrismaMock(opts: {
  priorInternalStatus?: string | null;
  createError?: { code: string } | Error;
}) {
  const tx: TxMock = {
    shipmentTrackingEvent: {
      findFirst: jest.fn().mockResolvedValue(
        opts.priorInternalStatus
          ? { internalStatus: opts.priorInternalStatus }
          : null,
      ),
      create: opts.createError
        ? jest.fn().mockRejectedValue(opts.createError)
        : jest.fn().mockResolvedValue({}),
    },
    subOrder: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest
        .fn()
        .mockResolvedValue({ ndrAttemptCount: 0, masterOrderId: 'master-1' }),
    },
    ndrAttempt: { create: jest.fn().mockResolvedValue({}) },
    rtoEvent: { create: jest.fn().mockResolvedValue({}) },
    rtoCreditNotePending: { create: jest.fn().mockResolvedValue({}) },
    subOrderTaxSummary: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (fn: any) => {
      // Execute the callback with `tx` and surface any thrown error.
      return fn(tx);
    }),
  };
  return { prisma, tx };
}

function buildEventBus() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildUseCase(
  prisma: any,
  eventBus: any,
): IngestTrackingUpdateUseCase {
  const resolver: any = { forMethod: jest.fn() };
  return new IngestTrackingUpdateUseCase(
    resolver,
    prisma,
    eventBus,
    new ShipmentStateService(),
  );
}

function snapshot(currentStatus: string, opts?: { scanAt?: Date }): TrackingSnapshot {
  return {
    awb: 'AWB001',
    carrier: 'Shiprocket',
    direction: 'forward',
    currentStatus,
    rawCurrentStatus: currentStatus,
    scans: [
      {
        status: currentStatus,
        rawStatus: currentStatus,
        rawStatusCode: '7',
        scanLocation: 'Mumbai',
        remark: '',
        scanAt: opts?.scanAt ?? new Date('2026-05-22T10:00:00Z'),
      },
    ],
  };
}

describe('IngestTrackingUpdateUseCase.applySnapshot (Phase 86)', () => {
  describe('history write — Gap #1/#17', () => {
    it('writes a ShipmentTrackingEvent row with source attribution', async () => {
      const { prisma, tx } = buildPrismaMock({ priorInternalStatus: null });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(prisma, eventBus);

      const res = await useCase.applySnapshot(
        'sub-1',
        snapshot('IN_TRANSIT'),
        { source: 'WEBHOOK_SHIPROCKET', rawPayload: { awb_number: 'AWB001' } },
      );

      expect(res.applied).toBe(true);
      expect(tx.shipmentTrackingEvent.create).toHaveBeenCalledTimes(1);
      const created = tx.shipmentTrackingEvent.create.mock.calls[0][0].data;
      expect(created.subOrderId).toBe('sub-1');
      expect(created.internalStatus).toBe('IN_TRANSIT');
      expect(created.externalStatus).toBe('IN_TRANSIT');
      expect(created.source).toBe('WEBHOOK_SHIPROCKET');
      expect(created.rawPayload).toEqual({ awb_number: 'AWB001' });
    });

    it('defaults source to POLL_CRON when not specified', async () => {
      const { prisma, tx } = buildPrismaMock({ priorInternalStatus: null });
      const useCase = buildUseCase(prisma, buildEventBus());

      await useCase.applySnapshot('sub-1', snapshot('IN_TRANSIT'));

      expect(
        tx.shipmentTrackingEvent.create.mock.calls[0][0].data.source,
      ).toBe('POLL_CRON');
    });
  });

  describe('transactional commit — Gap #11', () => {
    it('runs subOrder.update + tracking event + publish under one tx', async () => {
      const { prisma, tx } = buildPrismaMock({ priorInternalStatus: null });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(prisma, eventBus);

      await useCase.applySnapshot('sub-1', snapshot('IN_TRANSIT'));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.subOrder.update).toHaveBeenCalledTimes(1);
      expect(tx.shipmentTrackingEvent.create).toHaveBeenCalledTimes(1);
      // Publish receives `{ tx }` (Gap #22 — outbox-aware) — the
      // second arg should contain the same tx instance.
      const publishOpts = eventBus.publish.mock.calls[0][1];
      expect(publishOpts).toEqual({ tx });
    });
  });

  describe('FSM rejection — Gap #3/#21', () => {
    it('returns reason=FSM_REJECTED when prior status forbids the transition', async () => {
      const { prisma, tx } = buildPrismaMock({
        priorInternalStatus: 'DELIVERED',
      });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(prisma, eventBus);

      const res = await useCase.applySnapshot('sub-1', snapshot('IN_TRANSIT'));

      expect(res.applied).toBe(false);
      expect(res.reason).toBe('FSM_REJECTED');
      // No row inserted, no publish fired.
      expect(tx.shipmentTrackingEvent.create).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('duplicate absorption — P2002', () => {
    it('returns reason=DUPLICATE_SCAN when unique constraint fires', async () => {
      const { prisma } = buildPrismaMock({
        priorInternalStatus: 'IN_TRANSIT',
        createError: { code: 'P2002' },
      });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(prisma, eventBus);

      const res = await useCase.applySnapshot('sub-1', snapshot('IN_TRANSIT'));

      expect(res.applied).toBe(false);
      expect(res.reason).toBe('DUPLICATE_SCAN');
    });
  });

  describe('SHIPMENT_DELIVERED emission — Gap #13', () => {
    it('emits SHIPMENT_DELIVERED + TRACKING_UPDATED on DELIVERED scan', async () => {
      const { prisma } = buildPrismaMock({ priorInternalStatus: 'IN_TRANSIT' });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(prisma, eventBus);

      await useCase.applySnapshot('sub-1', snapshot('DELIVERED'));

      const eventNames = eventBus.publish.mock.calls.map(
        (c: any[]) => c[0].eventName,
      );
      expect(eventNames).toContain(SHIPPING_EVENTS.TRACKING_UPDATED);
      expect(eventNames).toContain(SHIPPING_EVENTS.SHIPMENT_DELIVERED);
    });
  });

  describe('SHIPMENT_LOST emission — Gap #7/#27', () => {
    it('emits SHIPMENT_LOST on LOST scan', async () => {
      const { prisma } = buildPrismaMock({ priorInternalStatus: 'IN_TRANSIT' });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(prisma, eventBus);

      await useCase.applySnapshot('sub-1', snapshot('LOST'));

      const eventNames = eventBus.publish.mock.calls.map(
        (c: any[]) => c[0].eventName,
      );
      expect(eventNames).toContain(SHIPPING_EVENTS.SHIPMENT_LOST);
    });

    it('emits SHIPMENT_LOST on DAMAGED scan with cause=DAMAGED', async () => {
      const { prisma } = buildPrismaMock({ priorInternalStatus: 'IN_TRANSIT' });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(prisma, eventBus);

      await useCase.applySnapshot('sub-1', snapshot('DAMAGED'));

      const lostCall = eventBus.publish.mock.calls.find(
        (c: any[]) => c[0].eventName === SHIPPING_EVENTS.SHIPMENT_LOST,
      );
      expect(lostCall).toBeDefined();
      expect(lostCall[0].payload.cause).toBe('DAMAGED');
    });

    it('does NOT emit SHIPMENT_LOST on benign IN_TRANSIT scan', async () => {
      const { prisma } = buildPrismaMock({ priorInternalStatus: 'PICKED_UP' });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(prisma, eventBus);

      await useCase.applySnapshot('sub-1', snapshot('IN_TRANSIT'));

      const eventNames = eventBus.publish.mock.calls.map(
        (c: any[]) => c[0].eventName,
      );
      expect(eventNames).not.toContain(SHIPPING_EVENTS.SHIPMENT_LOST);
    });
  });

  describe('fulfillmentStatus mapping — Gap #27', () => {
    it('promotes SHIPPED on RTO_IN_TRANSIT', async () => {
      const { prisma, tx } = buildPrismaMock({ priorInternalStatus: 'RTO_INITIATED' });
      const useCase = buildUseCase(prisma, buildEventBus());

      await useCase.applySnapshot('sub-1', snapshot('RTO_IN_TRANSIT'));

      const upd = tx.subOrder.update.mock.calls[0][0].data;
      expect(upd.fulfillmentStatus).toBe('SHIPPED');
    });

    it('promotes CANCELLED on LOST', async () => {
      const { prisma, tx } = buildPrismaMock({ priorInternalStatus: 'IN_TRANSIT' });
      const useCase = buildUseCase(prisma, buildEventBus());

      await useCase.applySnapshot('sub-1', snapshot('LOST'));

      const upd = tx.subOrder.update.mock.calls[0][0].data;
      expect(upd.fulfillmentStatus).toBe('CANCELLED');
    });
  });
});
