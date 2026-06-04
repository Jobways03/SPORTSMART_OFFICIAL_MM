/**
 * Phase 52 (2026-05-21) — cron loop, expiredAt stamp, ledger writes,
 * aggregate event emission.
 */

import { StockReservationStatus } from '@prisma/client';
import { ReservationExpirySweepCron } from './reservation-expiry-sweep.cron';

function makeCron() {
  const sellerProductMapping = {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const stockReservation = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(),
  };
  const prisma: any = {
    sellerProductMapping,
    stockReservation,
    $transaction: jest.fn(async (fn: any) =>
      fn({ sellerProductMapping, stockReservation }),
    ),
  };
  const env = {
    getBoolean: jest.fn(() => true),
    getNumber: jest.fn((_k: string, def: number) => def),
  } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const leader = { run: jest.fn(async (_k: string, _ttl: number, fn: any) => fn()) } as any;
  const ledger = { record: jest.fn().mockResolvedValue(undefined) } as any;
  // Cluster C (#210-#8) — best-effort per-run audit summary row.
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const cron = new ReservationExpirySweepCron(prisma, env, eventBus, leader, ledger, audit);
  return { cron, prisma, sellerProductMapping, stockReservation, eventBus, ledger, audit };
}

describe('ReservationExpirySweepCron (Phase 52)', () => {
  it('stamps expiredAt + decrements reservedQty + writes ledger row per flipped reservation', async () => {
    const { cron, sellerProductMapping, stockReservation, ledger } = makeCron();
    stockReservation.findMany
      .mockResolvedValueOnce([{ id: 'r-1', mappingId: 'm-1', quantity: 3, orderId: 'o-1' }])
      .mockResolvedValueOnce([]);
    stockReservation.updateMany.mockResolvedValue({ count: 1 });
    sellerProductMapping.findUnique.mockResolvedValueOnce({ stockQty: 10, reservedQty: 5 });

    const out = await cron.sweepUntilEmpty();

    expect(stockReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r-1', status: 'RESERVED' },
      data: { status: 'EXPIRED', expiredAt: expect.any(Date) },
    });
    expect(sellerProductMapping.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { reservedQty: 2 },
    });
    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'RELEASED',
        referenceType: 'RESERVATION_EXPIRY',
        referenceId: 'r-1',
        quantityDelta: 3,
        beforeReservedQty: 5,
        afterReservedQty: 2,
      }),
    );
    expect(out.expired).toBe(1);
  });

  it('skips ledger + decrement when CAS-flip loses the race (count=0)', async () => {
    const { cron, sellerProductMapping, stockReservation, ledger } = makeCron();
    stockReservation.findMany
      .mockResolvedValueOnce([{ id: 'r-1', mappingId: 'm-1', quantity: 3, orderId: 'o-1' }])
      .mockResolvedValueOnce([]);
    stockReservation.updateMany.mockResolvedValueOnce({ count: 0 });

    await cron.sweepUntilEmpty();

    expect(sellerProductMapping.update).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('LOOPS until the batch is empty (Gap #8)', async () => {
    const { cron, sellerProductMapping, stockReservation } = makeCron();
    // First call: 2 expired rows. Second: 1 more. Third: empty.
    stockReservation.findMany
      .mockResolvedValueOnce([
        { id: 'r-1', mappingId: 'm-1', quantity: 1, orderId: 'o-1' },
        { id: 'r-2', mappingId: 'm-2', quantity: 2, orderId: 'o-2' },
      ])
      .mockResolvedValueOnce([
        { id: 'r-3', mappingId: 'm-3', quantity: 3, orderId: 'o-3' },
      ])
      .mockResolvedValueOnce([]);
    stockReservation.updateMany.mockResolvedValue({ count: 1 });
    sellerProductMapping.findUnique.mockResolvedValue({ stockQty: 10, reservedQty: 5 });

    const out = await cron.sweepUntilEmpty();

    expect(out.iterations).toBe(3);
    expect(out.expired).toBe(3);
  });

  it('emits a batch event with aggregate counts (Gap #12)', async () => {
    const { cron, eventBus, stockReservation, sellerProductMapping } = makeCron();
    stockReservation.findMany
      .mockResolvedValueOnce([{ id: 'r-1', mappingId: 'm-1', quantity: 1, orderId: 'o-1' }])
      .mockResolvedValueOnce([]);
    stockReservation.updateMany.mockResolvedValue({ count: 1 });
    sellerProductMapping.findUnique.mockResolvedValue({ stockQty: 10, reservedQty: 5 });

    await cron.sweepUntilEmpty();

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'inventory.reservation.expired_batch',
        payload: expect.objectContaining({ expired: 1, failed: 0 }),
      }),
    );
  });

  it('does NOT emit the batch event when nothing was swept', async () => {
    const { cron, eventBus, stockReservation } = makeCron();
    stockReservation.findMany.mockResolvedValueOnce([]);

    await cron.sweepUntilEmpty();

    // Per-row event bus calls would still happen if there were rows;
    // batch event only fires when there was actual work.
    const batchCalls = eventBus.publish.mock.calls.filter(
      (c: any[]) => c[0]?.eventName === 'inventory.reservation.expired_batch',
    );
    expect(batchCalls).toHaveLength(0);
  });

  it('writes a best-effort audit summary row per run with totals (#210-#8)', async () => {
    const { cron, audit, stockReservation, sellerProductMapping } = makeCron();
    stockReservation.findMany
      .mockResolvedValueOnce([{ id: 'r-1', mappingId: 'm-1', quantity: 1, orderId: 'o-1' }])
      .mockResolvedValueOnce([]);
    stockReservation.updateMany.mockResolvedValue({ count: 1 });
    sellerProductMapping.findUnique.mockResolvedValue({ stockQty: 10, reservedQty: 5 });

    await cron.sweepUntilEmpty();

    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RESERVATION_EXPIRY_SWEEP',
        module: 'inventory',
        newValue: expect.objectContaining({ expired: 1, failed: 0 }),
      }),
    );
  });

  it('does NOT write an audit row when nothing was swept', async () => {
    const { cron, audit, stockReservation } = makeCron();
    stockReservation.findMany.mockResolvedValueOnce([]);

    await cron.sweepUntilEmpty();

    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('does not throw when the audit summary write fails (best-effort)', async () => {
    const { cron, audit, stockReservation, sellerProductMapping } = makeCron();
    stockReservation.findMany
      .mockResolvedValueOnce([{ id: 'r-1', mappingId: 'm-1', quantity: 1, orderId: 'o-1' }])
      .mockResolvedValueOnce([]);
    stockReservation.updateMany.mockResolvedValue({ count: 1 });
    sellerProductMapping.findUnique.mockResolvedValue({ stockQty: 10, reservedQty: 5 });
    audit.writeAuditLog.mockRejectedValueOnce(new Error('audit DB down'));

    await expect(cron.sweepUntilEmpty()).resolves.toEqual(
      expect.objectContaining({ expired: 1 }),
    );
  });
});
