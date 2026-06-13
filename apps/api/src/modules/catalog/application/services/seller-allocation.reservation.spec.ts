/**
 * Phase 52 polish (2026-05-21) — pins the SellerAllocationService
 * reservation contract:
 *   - attribution columns (customerId/sessionId/cartId) are
 *     persisted from the input options (Gap #5)
 *   - quantity is capped at MAX_RESERVATION_QUANTITY (Gap #14)
 *   - a RESERVED StockMovement ledger row is written on success
 *     (Gap #9)
 *
 * 2026-06-13 (H2) — reserveStock now self-enforces the mapping
 * lifecycle inside the FOR UPDATE: a reservation is rejected unless the
 * locked row is APPROVED + active + not soft-deleted. The locked-row
 * fixtures therefore carry those columns, and a dedicated test pins the
 * orderability gate.
 *
 * We don't exercise the full allocation scoring here — that's
 * covered by the existing allocation specs. This file isolates the
 * Phase 52 polish work.
 */

import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { SellerAllocationService } from './seller-allocation.service';
import { MAX_RESERVATION_QUANTITY } from '../../../inventory/application/facades/inventory-public.facade';

/** A FOR UPDATE-locked mapping row that is orderable by default. */
function lockedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    stock_qty: 10,
    reserved_qty: 0,
    approval_status: 'APPROVED',
    is_active: true,
    deleted_at: null,
    ...over,
  };
}

function makeService() {
  const sellerProductMapping = {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const stockReservation = {
    create: jest.fn(),
  };
  const prisma: any = {
    sellerProductMapping,
    stockReservation,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (fn: any) => {
      const tx = {
        sellerProductMapping,
        stockReservation,
        $queryRaw: prisma.$queryRaw,
      };
      return fn(tx);
    }),
  };
  const env = { getNumber: jest.fn((_k: string, def: number) => def) } as any;
  const postOfficeCache = { lookup: jest.fn() } as any;
  const stockLedger = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new SellerAllocationService(prisma, env, postOfficeCache, stockLedger);
  return { service, prisma, sellerProductMapping, stockReservation, stockLedger };
}

describe('SellerAllocationService.reserveStock (Phase 52 polish)', () => {
  it('rejects quantity < 1', async () => {
    const { service } = makeService();
    await expect(
      service.reserveStock({ mappingId: 'm-1', quantity: 0 }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('caps quantity at MAX_RESERVATION_QUANTITY', async () => {
    const { service } = makeService();
    await expect(
      service.reserveStock({
        mappingId: 'm-1',
        quantity: MAX_RESERVATION_QUANTITY + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('throws Conflict on insufficient stock', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([
      lockedRow({ stock_qty: 5, reserved_qty: 3 }),
    ]);
    await expect(
      service.reserveStock({ mappingId: 'm-1', quantity: 10 }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('throws NotFound when the locked row is missing', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.reserveStock({ mappingId: 'm-ghost', quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  // H2 — the directly-exposed reserve primitive must reject mappings the
  // platform has taken offline. Each of these would have been reservable
  // (and then confirm-deducted) before the gate.
  it.each([
    ['unapproved (PENDING_APPROVAL)', { approval_status: 'PENDING_APPROVAL' }],
    ['stopped', { approval_status: 'STOPPED' }],
    ['rejected', { approval_status: 'REJECTED' }],
    ['inactive (paused)', { is_active: false }],
    ['soft-deleted', { deleted_at: new Date() }],
  ])('rejects a reservation against a %s mapping with plenty of stock', async (_label, over) => {
    const { service, prisma, stockReservation } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([lockedRow(over)]);
    await expect(
      service.reserveStock({ mappingId: 'm-1', quantity: 1 }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    // no reservation row is created when the gate rejects
    expect(stockReservation.create).not.toHaveBeenCalled();
  });

  it('persists customerId/sessionId/cartId attribution from the input', async () => {
    const { service, prisma, stockReservation } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([lockedRow({ reserved_qty: 0 })]);
    stockReservation.create.mockResolvedValueOnce({
      id: 'r-1',
      mappingId: 'm-1',
      quantity: 3,
      status: 'RESERVED',
      orderId: null,
      expiresAt: new Date(),
    });

    await service.reserveStock({
      mappingId: 'm-1',
      quantity: 3,
      customerId: 'c-7',
      sessionId: 's-7',
      cartId: 'cart-7',
    });

    expect(stockReservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mappingId: 'm-1',
        quantity: 3,
        customerId: 'c-7',
        sessionId: 's-7',
        cartId: 'cart-7',
      }),
    });
  });

  it('writes a RESERVED ledger row referencing the reservation id', async () => {
    const { service, prisma, stockReservation, stockLedger } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([lockedRow({ reserved_qty: 2 })]);
    stockReservation.create.mockResolvedValueOnce({
      id: 'r-1',
      mappingId: 'm-1',
      quantity: 3,
      status: 'RESERVED',
      orderId: 'order-1',
      expiresAt: new Date(),
    });

    await service.reserveStock({
      mappingId: 'm-1',
      quantity: 3,
      orderId: 'order-1',
      customerId: 'c-7',
    });

    expect(stockLedger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'RESERVED',
        resourceId: 'm-1',
        referenceType: 'RESERVATION',
        referenceId: 'r-1',
        quantityDelta: 3,
        beforeReservedQty: 2,
        afterReservedQty: 5,
        actorId: 'c-7',
        actorRole: 'CUSTOMER',
      }),
    );
  });

  it('uses SYSTEM actorRole when no customerId is provided', async () => {
    const { service, prisma, stockReservation, stockLedger } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([lockedRow({ reserved_qty: 0 })]);
    stockReservation.create.mockResolvedValueOnce({
      id: 'r-1',
      mappingId: 'm-1',
      quantity: 1,
      status: 'RESERVED',
      orderId: null,
      expiresAt: new Date(),
    });

    await service.reserveStock({ mappingId: 'm-1', quantity: 1 });

    expect(stockLedger.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'SYSTEM' }),
    );
  });
});
