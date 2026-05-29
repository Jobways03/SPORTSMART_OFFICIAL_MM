// Phase 87 (2026-05-23) — NDR/RTO ingest persistence.
//
// Covers:
//   Gap #5/#11  — ndr_attempts row + counter bump on UNDELIVERED
//   Gap #6      — rto_events row + RTO timestamp persistence
//   Gap #13     — RTO_INITIATED event emission
//   Gap #17     — NDR_RAISED carries attemptNumber
//   Gap #19     — rto_credit_note_pending row on RTO_DELIVERED
//   Gap #20     — REV_* scans short-circuit with REVERSE_LEG_SKIPPED

import { IngestTrackingUpdateUseCase } from './ingest-tracking-update.use-case';
import { ShipmentStateService } from '../services/shipment-state.service';
import { SHIPPING_EVENTS } from '../../domain/events/shipping.events';
import type { TrackingSnapshot } from '../ports/outbound/courier-gateway.port';

function buildTx(opts: {
  priorInternalStatus?: string | null;
  priorNdrAttemptCount?: number;
  taxSummary?: { taxableValueInPaise: bigint; totalTaxInPaise: bigint };
} = {}) {
  return {
    shipmentTrackingEvent: {
      findFirst: jest.fn().mockResolvedValue(
        opts.priorInternalStatus
          ? { internalStatus: opts.priorInternalStatus }
          : null,
      ),
      create: jest.fn().mockResolvedValue({}),
    },
    subOrder: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({
        ndrAttemptCount: opts.priorNdrAttemptCount ?? 0,
        masterOrderId: 'master-1',
      }),
    },
    ndrAttempt: { create: jest.fn().mockResolvedValue({}) },
    rtoEvent: { create: jest.fn().mockResolvedValue({}) },
    rtoCreditNotePending: { create: jest.fn().mockResolvedValue({}) },
    subOrderTaxSummary: {
      findFirst: jest.fn().mockResolvedValue(opts.taxSummary ?? null),
    },
  };
}

function buildPrisma(tx: any) {
  return {
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };
}

function buildEventBus() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildUseCase(prisma: any, eventBus: any) {
  return new IngestTrackingUpdateUseCase(
    { forMethod: jest.fn() } as any,
    prisma,
    eventBus,
    new ShipmentStateService(),
  );
}

function snapshot(
  currentStatus: string,
  scanReason?: string,
  rawStatusCode?: string,
): TrackingSnapshot {
  return {
    awb: 'AWB001',
    carrier: 'Shiprocket',
    direction: currentStatus.startsWith('RTO') ? 'reverse' : 'forward',
    currentStatus,
    rawCurrentStatus: currentStatus,
    scans: [
      {
        status: currentStatus,
        rawStatus: currentStatus,
        rawStatusCode: rawStatusCode ?? '7',
        scanLocation: 'Mumbai Hub',
        remark: scanReason ?? '',
        scanAt: new Date('2026-05-22T10:00:00Z'),
      },
    ],
  };
}

describe('IngestTrackingUpdateUseCase Phase 87 — NDR/RTO', () => {
  describe('NDR persistence — Gaps #5/#11/#17', () => {
    it('UNDELIVERED scan creates NdrAttempt row + bumps counter', async () => {
      const tx = buildTx({
        priorInternalStatus: 'OUT_FOR_DELIVERY',
        priorNdrAttemptCount: 0,
      });
      const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
      await useCase.applySnapshot(
        'sub-1',
        snapshot('UNDELIVERED', 'Customer unavailable', 'UD-04'),
      );

      expect(tx.ndrAttempt.create).toHaveBeenCalledTimes(1);
      const ndrCreate = tx.ndrAttempt.create.mock.calls[0][0].data;
      expect(ndrCreate.subOrderId).toBe('sub-1');
      expect(ndrCreate.attemptNumber).toBe(1);
      expect(ndrCreate.reason).toBe('Customer unavailable');
      expect(ndrCreate.reasonCode).toBe('UD-04');

      const subPatch = tx.subOrder.update.mock.calls[0][0].data;
      expect(subPatch.ndrAttemptCount).toBe(1);
      expect(subPatch.ndrLastReason).toBe('Customer unavailable');
      expect(subPatch.ndrStatus).toBe('PENDING_REATTEMPT');
    });

    it('subsequent UNDELIVERED bumps to attempt 2', async () => {
      const tx = buildTx({
        priorInternalStatus: 'UNDELIVERED',
        priorNdrAttemptCount: 1,
      });
      const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
      await useCase.applySnapshot('sub-1', snapshot('UNDELIVERED'));
      expect(tx.ndrAttempt.create.mock.calls[0][0].data.attemptNumber).toBe(2);
      expect(tx.subOrder.update.mock.calls[0][0].data.ndrAttemptCount).toBe(2);
    });

    it('NDR_RAISED event carries attemptNumber (Gap #17)', async () => {
      const tx = buildTx({
        priorInternalStatus: 'OUT_FOR_DELIVERY',
        priorNdrAttemptCount: 1,
      });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(buildPrisma(tx), eventBus);
      await useCase.applySnapshot('sub-1', snapshot('UNDELIVERED', 'wrong address'));
      const ndrEvent = eventBus.publish.mock.calls.find(
        (c) => c[0].eventName === SHIPPING_EVENTS.NDR_RAISED,
      );
      expect(ndrEvent).toBeDefined();
      expect(ndrEvent![0].payload.attemptNumber).toBe(2);
      expect(ndrEvent![0].payload.reason).toBe('wrong address');
    });
  });

  describe('RTO persistence — Gaps #6/#13', () => {
    it('RTO_INITIATED writes RtoEvent + sets rtoInitiatedAt', async () => {
      const tx = buildTx({ priorInternalStatus: 'OUT_FOR_DELIVERY' });
      const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
      await useCase.applySnapshot('sub-1', snapshot('RTO_INITIATED', 'NDR exhausted'));

      expect(tx.rtoEvent.create).toHaveBeenCalledTimes(1);
      const created = tx.rtoEvent.create.mock.calls[0][0].data;
      expect(created.status).toBe('RTO_INITIATED');

      const subPatch = tx.subOrder.update.mock.calls[0][0].data;
      expect(subPatch.rtoInitiatedAt).toBeInstanceOf(Date);
      expect(subPatch.ndrStatus).toBe('EXHAUSTED');
    });

    it('emits RTO_INITIATED event (Gap #13 — was never published pre-Phase-87)', async () => {
      const tx = buildTx({ priorInternalStatus: 'IN_TRANSIT' });
      const eventBus = buildEventBus();
      const useCase = buildUseCase(buildPrisma(tx), eventBus);
      await useCase.applySnapshot('sub-1', snapshot('RTO_INITIATED'));

      const names = eventBus.publish.mock.calls.map((c) => c[0].eventName);
      expect(names).toContain(SHIPPING_EVENTS.RTO_INITIATED);
    });

    it('RTO_IN_TRANSIT sets rtoInTransitAt', async () => {
      const tx = buildTx({ priorInternalStatus: 'RTO_INITIATED' });
      const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
      await useCase.applySnapshot('sub-1', snapshot('RTO_IN_TRANSIT'));
      const subPatch = tx.subOrder.update.mock.calls[0][0].data;
      expect(subPatch.rtoInTransitAt).toBeInstanceOf(Date);
    });

    it('RTO_DELIVERED sets rtoDeliveredAt + writes RtoEvent', async () => {
      const tx = buildTx({ priorInternalStatus: 'RTO_IN_TRANSIT' });
      const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
      await useCase.applySnapshot('sub-1', snapshot('RTO_DELIVERED'));
      const subPatch = tx.subOrder.update.mock.calls[0][0].data;
      expect(subPatch.rtoDeliveredAt).toBeInstanceOf(Date);
      const rtoCreate = tx.rtoEvent.create.mock.calls[0][0].data;
      expect(rtoCreate.status).toBe('RTO_DELIVERED');
    });
  });

  describe('GST credit-note pending — Gap #19', () => {
    it('RTO_DELIVERED queues a rto_credit_note_pending row', async () => {
      const tx = buildTx({
        priorInternalStatus: 'RTO_IN_TRANSIT',
        taxSummary: {
          taxableValueInPaise: 100000n,
          totalTaxInPaise: 18000n,
        },
      });
      const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
      await useCase.applySnapshot('sub-1', snapshot('RTO_DELIVERED'));

      expect(tx.rtoCreditNotePending.create).toHaveBeenCalledTimes(1);
      const created = tx.rtoCreditNotePending.create.mock.calls[0][0].data;
      expect(created.subOrderId).toBe('sub-1');
      expect(created.masterOrderId).toBe('master-1');
      expect(created.taxableAmountInPaise).toBe(100000n);
      expect(created.totalTaxInPaise).toBe(18000n);
      expect(created.status).toBe('PENDING');
    });

    it('RTO_DELIVERED still queues row when no tax summary (zero-amount placeholder)', async () => {
      const tx = buildTx({
        priorInternalStatus: 'RTO_IN_TRANSIT',
        taxSummary: undefined,
      });
      const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
      await useCase.applySnapshot('sub-1', snapshot('RTO_DELIVERED'));
      const created = tx.rtoCreditNotePending.create.mock.calls[0][0].data;
      expect(created.taxableAmountInPaise).toBe(0n);
      expect(created.totalTaxInPaise).toBe(0n);
    });
  });

  describe('Reverse-leg skip — Gap #20', () => {
    it('REV_DELIVERED scan returns REVERSE_LEG_SKIPPED without writing tracking row, but publishes shipping.reverse_delivered (Phase 100 — Mark Received audit Gap #14)', async () => {
      const tx = buildTx();
      const eventBus = buildEventBus();
      const useCase = buildUseCase(buildPrisma(tx), eventBus);
      const res = await useCase.applySnapshot(
        'sub-1',
        snapshot('REV_DELIVERED'),
      );

      expect(res.applied).toBe(false);
      expect(res.reason).toBe('REVERSE_LEG_SKIPPED');
      expect(tx.shipmentTrackingEvent.create).not.toHaveBeenCalled();
      expect(tx.subOrder.update).not.toHaveBeenCalled();
      // Phase 100 — Mark Received audit Gap #14 closure. REV_DELIVERED
      // now publishes a domain event so the Returns module can
      // auto-mark its Return as RECEIVED. Other REV_* statuses still
      // skip silently (next test).
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'shipping.reverse_delivered',
          aggregate: 'SubOrder',
          aggregateId: 'sub-1',
        }),
      );
    });

    it('REV_PICKED_UP, REV_IN_TRANSIT also skip', async () => {
      for (const status of ['REV_PICKED_UP', 'REV_IN_TRANSIT', 'PENDING']) {
        const tx = buildTx();
        const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
        const res = await useCase.applySnapshot('sub-1', snapshot(status));
        expect(res.applied).toBe(false);
        expect(res.reason).toBe('REVERSE_LEG_SKIPPED');
      }
    });
  });

  describe('Last-courier-status mirror', () => {
    it('writes lastCourierStatus + lastCourierReasonCode on every accepted scan', async () => {
      const tx = buildTx({ priorInternalStatus: 'IN_TRANSIT' });
      const useCase = buildUseCase(buildPrisma(tx), buildEventBus());
      await useCase.applySnapshot(
        'sub-1',
        snapshot('OUT_FOR_DELIVERY', 'out for delivery', 'OD-01'),
      );
      const patch = tx.subOrder.update.mock.calls[0][0].data;
      expect(patch.lastCourierStatus).toBe('OUT_FOR_DELIVERY');
      expect(patch.lastCourierReasonCode).toBe('OD-01');
    });
  });
});
