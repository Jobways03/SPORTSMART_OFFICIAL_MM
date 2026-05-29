/**
 * Phase 55 (2026-05-21) — pins the security + correctness
 * properties of the confirmReceipt rewrite:
 *
 *   - Outer transaction wraps per-item processing + final status
 *     + finance totals (audit Gap #4 + #5).
 *   - Delta-based idempotency on retry — a repeated POST with the
 *     same payload adds ZERO stock (audit Gap #1).
 *   - Damaged units go into FranchiseStock.damagedQty + DAMAGE
 *     ledger row (audit Gap #3).
 *   - actorId threads through to the ledger (audit Gap #2).
 *   - receivedQty > dispatchedQty rejected (audit Gap #11).
 *   - Event payload includes items[] + ledgerEntryIds + stock
 *     snapshots (audit Gaps #12 + #15).
 *   - Per-stock change event emitted for low-stock subscribers
 *     (audit Gap #8).
 */

import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { ProcurementService } from './procurement.service';

function baseItem(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'item-1',
    procurementRequestId: 'req-1',
    productId: 'prod-1',
    variantId: null,
    globalSku: 'SKU-001',
    dispatchedQty: 10,
    receivedQty: 0,
    damagedQty: 0,
    status: 'DISPATCHED',
    ...over,
  };
}

function baseRequest(items: any[] = [baseItem()]) {
  return {
    id: 'req-1',
    franchiseId: 'franchise-1',
    requestNumber: 'REQ-001',
    status: 'DISPATCHED',
    items,
  };
}

function makeService(opts: { request?: any; itemsById?: Record<string, any> } = {}) {
  const procurementRepo: any = {
    findByIdWithItems: jest.fn().mockResolvedValue(opts.request ?? baseRequest()),
    findItemById: jest.fn(async (id: string) => opts.itemsById?.[id] ?? null),
    updateItem: jest.fn().mockResolvedValue(undefined),
    calculateTotals: jest.fn().mockResolvedValue({
      totalApprovedAmount: 1000,
      procurementFeeAmount: 100,
      finalPayableAmount: 1100,
    }),
    update: jest.fn(async (_id: string, data: any) => ({
      id: 'req-1',
      ...data,
      finalPayableAmount: data.finalPayableAmount ?? 1100,
    })),
  };
  const inventoryService: any = {
    addProcurementStock: jest.fn().mockResolvedValue({
      stock: { onHandQty: 10, availableQty: 10, damagedQty: 0 },
      ledgerEntry: { id: 'ledger-good-1' },
    }),
    addDamagedFromProcurement: jest.fn().mockResolvedValue({
      stock: { onHandQty: 10, availableQty: 10, damagedQty: 2 },
      ledgerEntry: { id: 'ledger-damage-1' },
    }),
  };
  const catalogRepo: any = {};
  const franchiseRepo: any = {};
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const prisma: any = {
    // Phase 159p — the tx now also writes a ProcurementRequestEvent history row.
    procurementRequestEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const env: any = { getNumber: jest.fn() };
  const commissionService: any = {};

  const service = new ProcurementService(
    procurementRepo,
    catalogRepo,
    franchiseRepo,
    inventoryService,
    commissionService,
    eventBus,
    logger,
    prisma,
    env,
  );
  return { service, procurementRepo, inventoryService, eventBus, prisma };
}

describe('ProcurementService.confirmReceipt (Phase 55)', () => {
  it('throws NotFound when the request does not exist', async () => {
    const { service, procurementRepo } = makeService();
    procurementRepo.findByIdWithItems.mockResolvedValueOnce(null);
    await expect(
      service.confirmReceipt('franchise-1', 'req-ghost', []),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws Forbidden when another franchise tries to receive', async () => {
    const { service } = makeService({
      request: { ...baseRequest(), franchiseId: 'OTHER' },
    });
    await expect(
      service.confirmReceipt('franchise-1', 'req-1', []),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('rejects receipts on DRAFT/SUBMITTED requests', async () => {
    const { service } = makeService({
      request: { ...baseRequest(), status: 'SUBMITTED' },
    });
    await expect(
      service.confirmReceipt('franchise-1', 'req-1', []),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('writes goodQty to onHand AND damagedQty to damagedQty on first receipt', async () => {
    const { service, inventoryService } = makeService({
      request: baseRequest([baseItem({ dispatchedQty: 10 })]),
      itemsById: { 'item-1': baseItem({ dispatchedQty: 10 }) },
    });
    await service.confirmReceipt(
      'franchise-1',
      'req-1',
      [{ itemId: 'item-1', receivedQty: 10, damagedQty: 2 }],
      'user-7',
    );

    // goodDelta = (10-2) - (0-0) = 8 → addProcurementStock(8)
    expect(inventoryService.addProcurementStock).toHaveBeenCalledWith(
      'franchise-1',
      'prod-1',
      null,
      'SKU-001',
      8,
      'req-1',
      'user-7',
      undefined,
      'FRANCHISE_USER',
      expect.any(Object),
    );
    // damagedDelta = 2 → addDamagedFromProcurement(2)
    expect(inventoryService.addDamagedFromProcurement).toHaveBeenCalledWith(
      'franchise-1',
      'prod-1',
      null,
      'SKU-001',
      2,
      'req-1',
      'user-7',
      expect.any(Object),
    );
  });

  it('IS IDEMPOTENT on retry — re-posting the same payload adds zero stock (audit Gap #1)', async () => {
    const { service, inventoryService } = makeService({
      // Existing state mirrors the first receipt that already happened.
      request: {
        ...baseRequest([
          baseItem({
            dispatchedQty: 10,
            receivedQty: 10,
            damagedQty: 2,
            status: 'RECEIVED',
          }),
        ]),
        status: 'PARTIALLY_RECEIVED',
      },
      itemsById: {
        'item-1': baseItem({
          dispatchedQty: 10,
          receivedQty: 10,
          damagedQty: 2,
          status: 'RECEIVED',
        }),
      },
    });
    await service.confirmReceipt(
      'franchise-1',
      'req-1',
      [{ itemId: 'item-1', receivedQty: 10, damagedQty: 2 }],
      'user-7',
    );

    // No deltas → no addProcurementStock / addDamagedFromProcurement.
    expect(inventoryService.addProcurementStock).not.toHaveBeenCalled();
    expect(inventoryService.addDamagedFromProcurement).not.toHaveBeenCalled();
  });

  it('adds only the DELTA on a top-up receipt (audit Gap #1)', async () => {
    const { service, inventoryService } = makeService({
      // First pass: received 4, damaged 0. Now receiving 8 more,
      // damaged 1. goodDelta = (10-1) - (4-0) = 5; damagedDelta = 1.
      request: {
        ...baseRequest([
          baseItem({ dispatchedQty: 10, receivedQty: 4, damagedQty: 0, status: 'SHORT' }),
        ]),
        status: 'PARTIALLY_RECEIVED',
      },
      itemsById: {
        'item-1': baseItem({
          dispatchedQty: 10,
          receivedQty: 4,
          damagedQty: 0,
          status: 'SHORT',
        }),
      },
    });
    await service.confirmReceipt(
      'franchise-1',
      'req-1',
      [{ itemId: 'item-1', receivedQty: 10, damagedQty: 1 }],
      'user-7',
    );

    expect(inventoryService.addProcurementStock).toHaveBeenCalledWith(
      'franchise-1', 'prod-1', null, 'SKU-001',
      5, // goodDelta
      'req-1', 'user-7', undefined, 'FRANCHISE_USER', expect.any(Object),
    );
    expect(inventoryService.addDamagedFromProcurement).toHaveBeenCalledWith(
      'franchise-1', 'prod-1', null, 'SKU-001',
      1, // damagedDelta
      'req-1', 'user-7', expect.any(Object),
    );
  });

  it('rejects over-receipt (receivedQty > dispatchedQty) — audit Gap #11', async () => {
    const { service } = makeService({
      itemsById: { 'item-1': baseItem({ dispatchedQty: 10 }) },
    });
    await expect(
      service.confirmReceipt(
        'franchise-1',
        'req-1',
        [{ itemId: 'item-1', receivedQty: 15 }],
        'user-7',
      ),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects negative-delta receipt (newReceived < oldReceived)', async () => {
    const { service } = makeService({
      itemsById: {
        'item-1': baseItem({ dispatchedQty: 10, receivedQty: 5 }),
      },
    });
    await expect(
      service.confirmReceipt(
        'franchise-1',
        'req-1',
        [{ itemId: 'item-1', receivedQty: 3 }],
        'user-7',
      ),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('skips REJECTED items (no stock add, no error)', async () => {
    const { service, inventoryService } = makeService({
      itemsById: { 'item-1': baseItem({ status: 'REJECTED' }) },
    });
    await service.confirmReceipt(
      'franchise-1',
      'req-1',
      [{ itemId: 'item-1', receivedQty: 5 }],
      'user-7',
    );
    expect(inventoryService.addProcurementStock).not.toHaveBeenCalled();
  });

  it('rejects items that belong to a different request', async () => {
    const { service } = makeService({
      itemsById: { 'item-1': baseItem({ procurementRequestId: 'OTHER_REQ' }) },
    });
    await expect(
      service.confirmReceipt(
        'franchise-1',
        'req-1',
        [{ itemId: 'item-1', receivedQty: 5 }],
        'user-7',
      ),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('passes actorId through to inventoryService — ledger attributes correctly', async () => {
    const { service, inventoryService } = makeService({
      itemsById: { 'item-1': baseItem() },
    });
    await service.confirmReceipt(
      'franchise-1',
      'req-1',
      [{ itemId: 'item-1', receivedQty: 5 }],
      'user-9',
    );
    // The seventh positional arg is actorId.
    const args = inventoryService.addProcurementStock.mock.calls[0];
    expect(args[6]).toBe('user-9');
    expect(args[8]).toBe('FRANCHISE_USER');
  });

  it('falls back to franchiseId when actorId is not provided', async () => {
    const { service, inventoryService } = makeService({
      itemsById: { 'item-1': baseItem() },
    });
    await service.confirmReceipt('franchise-1', 'req-1', [
      { itemId: 'item-1', receivedQty: 5 },
    ]);
    // The seventh positional arg is actorId — should be franchiseId.
    const args = inventoryService.addProcurementStock.mock.calls[0];
    expect(args[6]).toBe('franchise-1');
  });

  it('emits procurement.received event with items[] + ledgerEntryIds + stock snapshots (audit Gaps #12/#15)', async () => {
    const { service, eventBus } = makeService({
      itemsById: { 'item-1': baseItem() },
    });
    await service.confirmReceipt(
      'franchise-1',
      'req-1',
      [{ itemId: 'item-1', receivedQty: 10, damagedQty: 2 }],
      'user-7',
    );

    // First publish is the procurement.received event.
    const procurementEvent = eventBus.publish.mock.calls[0]?.[0];
    expect(procurementEvent.payload.items).toBeDefined();
    expect(procurementEvent.payload.items[0].ledgerEntryIds.length).toBeGreaterThan(0);
    expect(procurementEvent.payload.items[0].onHandQty).toBeDefined();
    expect(procurementEvent.payload.actorId).toBe('user-7');
  });

  it('emits a franchise_stock.changed event per affected stock for low-stock recompute (audit Gap #8)', async () => {
    const { service, eventBus } = makeService({
      itemsById: { 'item-1': baseItem() },
    });
    await service.confirmReceipt(
      'franchise-1',
      'req-1',
      [{ itemId: 'item-1', receivedQty: 5 }],
      'user-7',
    );

    const stockEvent = eventBus.publish.mock.calls.find(
      (c: any[]) => c[0]?.eventName === 'inventory.franchise_stock.changed',
    );
    expect(stockEvent).toBeDefined();
    expect(stockEvent![0].payload.franchiseId).toBe('franchise-1');
    expect(stockEvent![0].payload.goodDelta).toBe(5);
  });

  it('opens exactly ONE outer prisma.$transaction (audit Gap #4)', async () => {
    const { service, prisma } = makeService({
      itemsById: { 'item-1': baseItem() },
    });
    await service.confirmReceipt(
      'franchise-1',
      'req-1',
      [{ itemId: 'item-1', receivedQty: 5 }],
      'user-7',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
