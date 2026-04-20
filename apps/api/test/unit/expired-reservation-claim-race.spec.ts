import 'reflect-metadata';
import { SellerAllocationService } from '../../src/modules/catalog/application/services/seller-allocation.service';

/**
 * Regression test for the expired-reservation double-decrement race.
 *
 * Before: the sweeper `releaseExpiredReservations` runs every 60s on
 * every API instance (no distributed lock). Two instances could both
 * `findMany` the same expired reservation, both enter their own tx, and
 * both blindly `update({ where: {id} }, EXPIRED)` + decrement
 * reservedQty. Result: reservedQty driven below actual held stock,
 * corrupting availability math for that mapping.
 *
 * After: each instance claims the reservation atomically with
 * `updateMany({ where: {id, status: 'RESERVED'} })` and only decrements
 * reservedQty when `claim.count === 1`. The loser of the race no-ops.
 *
 * This test simulates the second-arriving instance: the row is already
 * EXPIRED by the time the tx runs, so updateMany returns count 0, and
 * the reservedQty decrement must not fire.
 */

describe('SellerAllocationService.releaseExpiredReservations — atomic claim', () => {
  const buildDeps = (opts: { claimCount: number }) => {
    const tx: any = {
      stockReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount }),
      },
      sellerProductMapping: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma: any = {
      stockReservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'res-1', mappingId: 'map-1', quantity: 3 },
        ]),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const env: any = { getNumber: (_k: string, d: number) => d };
    const svc = new SellerAllocationService(prisma, env);
    return { svc, tx };
  };

  it('decrements reservedQty when the claim wins (count === 1)', async () => {
    const { svc, tx } = buildDeps({ claimCount: 1 });
    const released = await svc.releaseExpiredReservations();
    expect(released).toBe(1);
    expect(tx.stockReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1', status: 'RESERVED' },
      data: { status: 'EXPIRED' },
    });
    expect(tx.sellerProductMapping.update).toHaveBeenCalledWith({
      where: { id: 'map-1' },
      data: { reservedQty: { decrement: 3 } },
    });
  });

  it('skips the decrement when another instance already claimed (count === 0)', async () => {
    const { svc, tx } = buildDeps({ claimCount: 0 });
    const released = await svc.releaseExpiredReservations();
    expect(released).toBe(0);
    // Critical assertion: reservedQty must NOT be decremented on lost race.
    expect(tx.sellerProductMapping.update).not.toHaveBeenCalled();
  });
});
