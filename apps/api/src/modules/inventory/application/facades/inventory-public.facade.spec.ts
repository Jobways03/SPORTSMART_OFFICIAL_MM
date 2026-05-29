/**
 * Phase 52 (2026-05-21) — pins the reservation lifecycle hardening:
 *
 *   - reserveStock caps quantity at MAX_RESERVATION_QUANTITY (Gap #14)
 *   - reserveStock writes a RESERVED ledger row (Gap #9)
 *   - reserveStock persists customerId/sessionId/cartId attribution (Gap #5)
 *   - releaseStock handles multi-row case via findMany + bulk CAS (Gap #6)
 *   - releaseStock writes RELEASED ledger row
 *   - releaseStock is a no-op when all candidate rows are already flipped
 *   - confirmDeduction is CAS-flipped (Gap #7) — aborts if status no longer RESERVED
 *   - confirmDeduction writes DEDUCTED ledger row
 *   - confirmDeduction uses the persisted reservation quantity (not caller's)
 *   - extendReservation enforces minute caps (Gap #13)
 *   - getReservation returns secondsRemaining (Gap #10)
 */

import { StockReservationStatus } from '@prisma/client';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  InventoryPublicFacade,
  MAX_RESERVATION_QUANTITY,
  MAX_RESERVATION_EXTENSION_MINUTES,
} from './inventory-public.facade';

function makeFacade() {
  const sellerProductMapping = {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const stockReservation = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma: any = {
    sellerProductMapping,
    stockReservation,
    $transaction: jest.fn(async (fn: any) =>
      fn({ sellerProductMapping, stockReservation }),
    ),
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const ledger = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const facade = new InventoryPublicFacade(prisma, eventBus, ledger);
  return { facade, prisma, sellerProductMapping, stockReservation, eventBus, ledger };
}

describe('InventoryPublicFacade.reserveStock (Phase 52)', () => {
  it('rejects negative or zero quantity', async () => {
    const { facade } = makeFacade();
    await expect(facade.reserveStock('m-1', 0, 'order-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    await expect(facade.reserveStock('m-1', -5, 'order-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('caps quantity at MAX_RESERVATION_QUANTITY (Gap #14)', async () => {
    const { facade } = makeFacade();
    await expect(
      facade.reserveStock('m-1', MAX_RESERVATION_QUANTITY + 1, 'order-1'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('returns false when the mapping has insufficient stock', async () => {
    const { facade, sellerProductMapping } = makeFacade();
    sellerProductMapping.findUnique.mockResolvedValueOnce({
      stockQty: 5,
      reservedQty: 3,
    });
    const ok = await facade.reserveStock('m-1', 10, 'order-1');
    expect(ok).toBe(false);
  });

  it('persists customerId/sessionId/cartId attribution (Gap #5)', async () => {
    const { facade, sellerProductMapping, stockReservation } = makeFacade();
    sellerProductMapping.findUnique.mockResolvedValueOnce({
      stockQty: 10,
      reservedQty: 0,
    });
    stockReservation.create.mockResolvedValueOnce({ id: 'r-1' });

    await facade.reserveStock('m-1', 3, 'order-1', {
      customerId: 'c-1',
      sessionId: 's-1',
      cartId: 'cart-1',
    });

    expect(stockReservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'c-1',
        sessionId: 's-1',
        cartId: 'cart-1',
      }),
    });
  });

  it('writes a RESERVED ledger row referencing the reservation id (Gap #9)', async () => {
    const { facade, sellerProductMapping, stockReservation, ledger } = makeFacade();
    sellerProductMapping.findUnique.mockResolvedValueOnce({
      stockQty: 10,
      reservedQty: 2,
    });
    stockReservation.create.mockResolvedValueOnce({ id: 'r-1' });

    await facade.reserveStock('m-1', 3, 'order-1', { customerId: 'c-7' });

    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'RESERVED',
        resourceId: 'm-1',
        referenceType: 'RESERVATION',
        referenceId: 'r-1',
        actorId: 'c-7',
        beforeStockQty: 10,
        afterStockQty: 10,
        beforeReservedQty: 2,
        afterReservedQty: 5,
      }),
    );
  });
});

describe('InventoryPublicFacade.releaseStock (Phase 52)', () => {
  it('flips multiple RESERVED rows for the same orderId (Gap #6)', async () => {
    const { facade, sellerProductMapping, stockReservation, ledger } = makeFacade();
    stockReservation.findMany.mockResolvedValueOnce([
      { id: 'r-1', quantity: 2 },
      { id: 'r-2', quantity: 3 },
    ]);
    stockReservation.updateMany.mockResolvedValueOnce({ count: 2 });
    sellerProductMapping.findUnique.mockResolvedValueOnce({
      stockQty: 10,
      reservedQty: 5,
    });

    await facade.releaseStock('m-1', 5, 'order-1');

    expect(stockReservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r-1', 'r-2'] }, status: 'RESERVED' },
      data: { status: 'RELEASED', releasedAt: expect.any(Date) },
    });
    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'RELEASED',
        quantityDelta: 5,
        beforeReservedQty: 5,
        afterReservedQty: 0,
      }),
    );
  });

  it('is a no-op when concurrent caller already flipped all rows', async () => {
    const { facade, stockReservation, ledger, sellerProductMapping } = makeFacade();
    stockReservation.findMany.mockResolvedValueOnce([{ id: 'r-1', quantity: 2 }]);
    stockReservation.updateMany.mockResolvedValueOnce({ count: 0 });

    await facade.releaseStock('m-1', 2, 'order-1');

    expect(sellerProductMapping.update).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('falls back to caller quantity when no live reservation rows exist (legacy path)', async () => {
    const { facade, sellerProductMapping, stockReservation, ledger } = makeFacade();
    stockReservation.findMany.mockResolvedValueOnce([]);
    sellerProductMapping.findUnique.mockResolvedValueOnce({
      stockQty: 10,
      reservedQty: 5,
    });

    await facade.releaseStock('m-1', 2, 'order-legacy');

    expect(sellerProductMapping.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { reservedQty: 3 },
    });
    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({ quantityDelta: 2, kind: 'RELEASED' }),
    );
  });
});

describe('InventoryPublicFacade.confirmDeduction (Phase 52 — CAS-flipped, Gap #7)', () => {
  it('aborts silently when status is no longer RESERVED', async () => {
    const { facade, stockReservation, sellerProductMapping, ledger } = makeFacade();
    stockReservation.findFirst.mockResolvedValueOnce({ id: 'r-1', quantity: 5 });
    stockReservation.updateMany.mockResolvedValueOnce({ count: 0 });

    await facade.confirmDeduction('m-1', 5, 'order-1');

    expect(sellerProductMapping.update).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('on success: CAS-flips to CONFIRMED with confirmedAt stamp', async () => {
    const { facade, stockReservation, sellerProductMapping } = makeFacade();
    stockReservation.findFirst.mockResolvedValueOnce({ id: 'r-1', quantity: 5 });
    stockReservation.updateMany.mockResolvedValueOnce({ count: 1 });
    sellerProductMapping.findUnique.mockResolvedValueOnce({
      stockQty: 10,
      reservedQty: 5,
    });

    await facade.confirmDeduction('m-1', 5, 'order-1');

    expect(stockReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r-1', status: 'RESERVED' },
      data: { status: 'CONFIRMED', confirmedAt: expect.any(Date) },
    });
  });

  it('decrements stockQty + reservedQty by the persisted reservation quantity, not the caller arg', async () => {
    const { facade, stockReservation, sellerProductMapping } = makeFacade();
    // Caller says 5, but the persisted reservation says 3.
    stockReservation.findFirst.mockResolvedValueOnce({ id: 'r-1', quantity: 3 });
    stockReservation.updateMany.mockResolvedValueOnce({ count: 1 });
    sellerProductMapping.findUnique.mockResolvedValueOnce({
      stockQty: 10,
      reservedQty: 5,
    });

    await facade.confirmDeduction('m-1', 5, 'order-1');

    expect(sellerProductMapping.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { stockQty: 7, reservedQty: 2 },
    });
  });

  it('writes a DEDUCTED ledger row on success', async () => {
    const { facade, stockReservation, sellerProductMapping, ledger } = makeFacade();
    stockReservation.findFirst.mockResolvedValueOnce({ id: 'r-1', quantity: 4 });
    stockReservation.updateMany.mockResolvedValueOnce({ count: 1 });
    sellerProductMapping.findUnique.mockResolvedValueOnce({
      stockQty: 10,
      reservedQty: 6,
    });

    await facade.confirmDeduction('m-1', 4, 'order-1');

    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'DEDUCTED',
        quantityDelta: 4,
        beforeStockQty: 10,
        afterStockQty: 6,
        beforeReservedQty: 6,
        afterReservedQty: 2,
      }),
    );
  });
});

describe('InventoryPublicFacade.extendReservation (Phase 52, Gap #13)', () => {
  it('rejects extraMinutes <= 0 or > MAX_RESERVATION_EXTENSION_MINUTES', async () => {
    const { facade } = makeFacade();
    await expect(facade.extendReservation('r-1', 0)).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    await expect(
      facade.extendReservation('r-1', MAX_RESERVATION_EXTENSION_MINUTES + 1),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('throws NotFound when the reservation does not exist', async () => {
    const { facade, stockReservation } = makeFacade();
    stockReservation.findUnique.mockResolvedValueOnce(null);
    await expect(facade.extendReservation('r-ghost', 5)).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('refuses to extend a non-RESERVED reservation', async () => {
    const { facade, stockReservation } = makeFacade();
    stockReservation.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      status: StockReservationStatus.CONFIRMED,
      expiresAt: new Date(),
      createdAt: new Date(),
    });
    await expect(facade.extendReservation('r-1', 5)).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('refuses to extend past the max-allowed window', async () => {
    const { facade, stockReservation } = makeFacade();
    // createdAt 25 minutes ago + extension already pushed expiresAt to
    // createdAt + 40 min. Asking for +5 more would land at createdAt+45,
    // past the 15+30=45 cap. Edge case — let's go past it.
    const createdAt = new Date(Date.now() - 25 * 60_000);
    const expiresAt = new Date(createdAt.getTime() + 40 * 60_000);
    stockReservation.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      status: StockReservationStatus.RESERVED,
      expiresAt,
      createdAt,
    });
    await expect(facade.extendReservation('r-1', 10)).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('extends within bounds and returns the new expiresAt', async () => {
    const { facade, stockReservation } = makeFacade();
    const createdAt = new Date(Date.now() - 5 * 60_000);
    const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
    stockReservation.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      status: StockReservationStatus.RESERVED,
      expiresAt,
      createdAt,
    });
    stockReservation.update.mockResolvedValueOnce({
      expiresAt: new Date(expiresAt.getTime() + 5 * 60_000),
    });

    const out = await facade.extendReservation('r-1', 5);
    expect(out.expiresAt).toEqual(new Date(expiresAt.getTime() + 5 * 60_000));
  });
});

describe('InventoryPublicFacade.getReservation (Phase 52, Gap #10)', () => {
  it('returns secondsRemaining floored to 0 for expired reservations', async () => {
    const { facade, prisma } = makeFacade();
    prisma.stockReservation.findUnique = jest.fn().mockResolvedValue({
      id: 'r-1',
      mappingId: 'm-1',
      quantity: 2,
      status: StockReservationStatus.RESERVED,
      expiresAt: new Date(Date.now() - 60_000),
      customerId: 'c-1',
    });

    const out = await facade.getReservation('r-1');
    expect(out?.secondsRemaining).toBe(0);
  });

  it('returns secondsRemaining ~positive for active reservations', async () => {
    const { facade, prisma } = makeFacade();
    prisma.stockReservation.findUnique = jest.fn().mockResolvedValue({
      id: 'r-1',
      mappingId: 'm-1',
      quantity: 2,
      status: StockReservationStatus.RESERVED,
      expiresAt: new Date(Date.now() + 120_000),
      customerId: 'c-1',
    });

    const out = await facade.getReservation('r-1');
    expect(out?.secondsRemaining).toBeGreaterThan(110);
    expect(out?.secondsRemaining).toBeLessThanOrEqual(120);
  });

  it('returns null when reservation does not exist', async () => {
    const { facade, prisma } = makeFacade();
    prisma.stockReservation.findUnique = jest.fn().mockResolvedValue(null);
    expect(await facade.getReservation('r-ghost')).toBeNull();
  });
});
