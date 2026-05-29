// Phase 69 (2026-05-22) — Phase 67 audit Gaps #1 + #5.

import { OrderFinalizationRecoveryCron } from './order-finalization-recovery.cron';

function makeCron(over: {
  candidates?: Array<{ id: string; orderNumber: string; createdAt: Date; orderStatus: string }>;
  taxSnapshotError?: Error;
  envEnabled?: boolean;
  alertMinutes?: number;
} = {}) {
  const findMany = jest.fn().mockResolvedValue(over.candidates ?? []);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma: any = {
    masterOrder: { findMany, updateMany },
  };
  const env: any = {
    getBoolean: (_k: string, fallback: boolean) =>
      over.envEnabled !== undefined ? over.envEnabled : fallback,
    getNumber: (k: string, fallback: number) => {
      if (k === 'ORDER_FINALIZATION_ALERT_MINUTES' && over.alertMinutes !== undefined) {
        return over.alertMinutes;
      }
      return fallback;
    },
  };
  const eventBus: any = {
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const leader: any = {
    run: jest.fn(async (_lock: string, _ttl: number, fn: () => Promise<void>) => fn()),
  };
  const taxSnapshot: any = {
    createSnapshotsForMasterOrder: jest.fn(
      over.taxSnapshotError
        ? jest.fn().mockRejectedValue(over.taxSnapshotError)
        : jest.fn().mockResolvedValue(undefined),
    ),
  };
  const cron = new OrderFinalizationRecoveryCron(prisma, env, eventBus, leader, taxSnapshot);
  return { cron, findMany, updateMany, eventBus, taxSnapshot };
}

describe('OrderFinalizationRecoveryCron', () => {
  it('no-ops when env flag is false', async () => {
    const { cron, findMany } = makeCron({ envEnabled: false });
    await cron.sweep();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns zeros when no candidates exist', async () => {
    const { cron } = makeCron({ candidates: [] });
    const result = await cron.runOnce();
    expect(result).toEqual({ scanned: 0, finalized: 0, stuck: 0 });
  });

  it('flips finalizedAt for every successful tax-snapshot replay', async () => {
    const candidates = [
      { id: 'mo-1', orderNumber: 'SM-1', createdAt: new Date(Date.now() - 15 * 60_000), orderStatus: 'PLACED' },
      { id: 'mo-2', orderNumber: 'SM-2', createdAt: new Date(Date.now() - 20 * 60_000), orderStatus: 'PLACED' },
    ];
    const { cron, updateMany, taxSnapshot } = makeCron({ candidates });
    const result = await cron.runOnce();
    expect(taxSnapshot.createSnapshotsForMasterOrder).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mo-1', finalizedAt: null },
        data: { finalizedAt: expect.any(Date) },
      }),
    );
    expect(result.finalized).toBe(2);
    expect(result.stuck).toBe(0);
  });

  it('emits finalisation_stuck event past the alert threshold', async () => {
    // Failing tax snapshot + age > alertMinutes (60 by default)
    // means the order is stuck.
    const candidates = [
      {
        id: 'mo-stuck',
        orderNumber: 'SM-S',
        createdAt: new Date(Date.now() - 90 * 60_000),
        orderStatus: 'PLACED',
      },
    ];
    const { cron, eventBus } = makeCron({
      candidates,
      taxSnapshotError: new Error('tax engine down'),
    });
    const result = await cron.runOnce();
    expect(result.stuck).toBe(1);
    expect(result.finalized).toBe(0);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.master.finalisation_stuck',
        aggregateId: 'mo-stuck',
        payload: expect.objectContaining({
          masterOrderId: 'mo-stuck',
          orderNumber: 'SM-S',
          reason: 'tax engine down',
        }),
      }),
    );
  });

  it('does not emit stuck event when failure is under the alert threshold', async () => {
    const candidates = [
      {
        id: 'mo-young-fail',
        orderNumber: 'SM-Y',
        createdAt: new Date(Date.now() - 30 * 60_000),
        orderStatus: 'PLACED',
      },
    ];
    const { cron, eventBus } = makeCron({
      candidates,
      taxSnapshotError: new Error('transient'),
    });
    const result = await cron.runOnce();
    expect(result.stuck).toBe(0);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('uses Phase 67 finalizedAt-null partial index predicate (verify findMany shape)', async () => {
    const { cron, findMany } = makeCron({ candidates: [] });
    await cron.runOnce();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          finalizedAt: null,
          orderStatus: { notIn: ['CANCELLED', 'EXCEPTION_QUEUE'] },
        }),
      }),
    );
  });
});
