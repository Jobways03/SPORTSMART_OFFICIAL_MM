import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FranchiseInventoryService } from '../../src/modules/franchise/application/services/franchise-inventory.service';
import { PrismaFranchiseInventoryRepository } from '../../src/modules/franchise/infrastructure/repositories/prisma-franchise-inventory.repository';
import { FranchiseAdjustStockDto } from '../../src/modules/franchise/presentation/dtos/franchise-adjust-stock.dto';
import { BadRequestAppException } from '../../src/core/exceptions';

/**
 * Phase 159o — Franchise Inventory Flow audit remediation.
 *
 *   #1  repo: under-lock availableQty guard on a reservedQty increment
 *   #4  service: DAMAGE adjustment runs both legs in ONE transaction
 *   #5  service: confirmShipment runs both legs in ONE transaction
 *   #16 service: confirmShipment is idempotent on (order, product, variant)
 *   #9  dto: quantity is a bounded, whole, signed integer
 *   #13 repo: low-stock detection filters + counts at the DATABASE
 */

// ── #1 — repository under-lock over-reservation guard ────────────────────────
describe('PrismaFranchiseInventoryRepository.adjustStockWithLedger — reservedQty guard (#1)', () => {
  function buildTx(stock: { onHandQty: number; reservedQty: number; availableQty: number }) {
    const locked = { id: 's1', ...stock };
    return {
      franchiseStock: {
        findFirst: jest.fn().mockResolvedValue(locked),
        findUnique: jest.fn().mockResolvedValue(locked),
        update: jest.fn().mockResolvedValue({ id: 's1' }),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 's1' }]),
      franchiseInventoryLedger: { create: jest.fn().mockResolvedValue({ id: 'l1' }) },
    } as any;
  }

  const baseParams = {
    franchiseId: 'fr1',
    productId: 'p1',
    variantId: null,
    globalSku: 'SKU',
    movementType: 'ORDER_RESERVE',
    referenceType: 'ORDER',
    actorType: 'SYSTEM',
    updateField: 'reservedQty' as const,
  };

  it('rejects a reservation that would drive availableQty negative (reserved > onHand)', async () => {
    // onHand 5, already reserved 3; reserving +5 → reserved 8 > onHand 5 → available -3
    const tx = buildTx({ onHandQty: 5, reservedQty: 3, availableQty: 2 });
    const repo = new PrismaFranchiseInventoryRepository({} as any);

    await expect(
      repo.adjustStockWithLedger({ ...baseParams, quantityDelta: 5 }, tx),
    ).rejects.toThrow(BadRequestAppException);

    // the guard fires BEFORE the write — no stock update, no ledger row
    expect(tx.franchiseStock.update).not.toHaveBeenCalled();
    expect(tx.franchiseInventoryLedger.create).not.toHaveBeenCalled();
  });

  it('allows a reservation that stays within on-hand', async () => {
    // onHand 5, reserved 3; reserving +2 → reserved 5, available 0 → OK
    const tx = buildTx({ onHandQty: 5, reservedQty: 3, availableQty: 2 });
    const repo = new PrismaFranchiseInventoryRepository({} as any);

    await repo.adjustStockWithLedger({ ...baseParams, quantityDelta: 2 }, tx);

    expect(tx.franchiseStock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reservedQty: 5, availableQty: 0 }) }),
    );
    expect(tx.franchiseInventoryLedger.create).toHaveBeenCalled();
  });
});

// ── #4 / #5 / #16 — service-layer atomicity + idempotency ────────────────────
describe('FranchiseInventoryService — atomic mutations + idempotency', () => {
  function build(opts: { existingShip?: boolean; stock?: any } = {}) {
    const fakeTx = { __tx: true } as any;
    const inventoryRepo: any = {
      adjustStockWithLedger: jest.fn().mockResolvedValue({ stock: {}, ledgerEntry: { id: 'l1' } }),
      findStock: jest
        .fn()
        .mockResolvedValue(opts.stock ?? { id: 's1', reservedQty: 10, onHandQty: 10, globalSku: 'SKU' }),
    };
    const catalogRepo: any = {
      findApprovedActiveByFranchiseAndProduct: jest.fn().mockResolvedValue({ id: 'm1' }),
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(fakeTx)),
      franchiseInventoryLedger: {
        findFirst: jest.fn().mockResolvedValue(opts.existingShip ? { id: 'ship-prev' } : null),
      },
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const svc = new FranchiseInventoryService(inventoryRepo, catalogRepo, prisma, eventBus);
    return { svc, inventoryRepo, catalogRepo, prisma, eventBus, fakeTx };
  }

  it('#4 — DAMAGE deducts on-hand AND adds damaged in a single transaction', async () => {
    const { svc, inventoryRepo, prisma, eventBus, fakeTx } = build();

    await svc.adjustStock('fr1', {
      productId: 'p1',
      adjustmentType: 'DAMAGE',
      quantity: 5,
      reason: 'water damage',
      actorType: 'FRANCHISE_OWNER',
      actorId: 'u1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(inventoryRepo.adjustStockWithLedger).toHaveBeenCalledTimes(2);
    // both legs use the SAME tx handle
    expect(inventoryRepo.adjustStockWithLedger).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ updateField: 'onHandQty', quantityDelta: -5 }),
      fakeTx,
    );
    expect(inventoryRepo.adjustStockWithLedger).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ updateField: 'damagedQty', quantityDelta: 5 }),
      fakeTx,
    );
    expect(eventBus.publish).toHaveBeenCalled();
  });

  it('#5 — confirmShipment reduces reserved AND on-hand in a single transaction', async () => {
    const { svc, inventoryRepo, prisma, fakeTx } = build();

    await svc.confirmShipment('fr1', 'p1', null, 4, 'order-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(inventoryRepo.adjustStockWithLedger).toHaveBeenCalledTimes(2);
    expect(inventoryRepo.adjustStockWithLedger).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ updateField: 'reservedQty', quantityDelta: -4, referenceId: 'order-1' }),
      fakeTx,
    );
    expect(inventoryRepo.adjustStockWithLedger).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ updateField: 'onHandQty', quantityDelta: -4, referenceId: 'order-1' }),
      fakeTx,
    );
  });

  it('#16 — a replayed confirmShipment for the same order is a no-op', async () => {
    const { svc, inventoryRepo, prisma } = build({ existingShip: true });

    const res = await svc.confirmShipment('fr1', 'p1', null, 4, 'order-1');

    expect(res.ledgerEntry).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(inventoryRepo.adjustStockWithLedger).not.toHaveBeenCalled();
  });
});

// ── #9 — adjust-stock DTO bounds ─────────────────────────────────────────────
describe('FranchiseAdjustStockDto — quantity bounds (#9)', () => {
  const base = {
    productId: '11111111-1111-1111-1111-111111111111',
    adjustmentType: 'ADJUSTMENT',
    reason: 'stock count correction',
  };
  const hasQuantityError = (errors: any[]) =>
    errors.some((e) => e.property === 'quantity');

  it('rejects a fractional quantity', async () => {
    const errors = await validate(plainToInstance(FranchiseAdjustStockDto, { ...base, quantity: 1.5 }));
    expect(hasQuantityError(errors)).toBe(true);
  });

  it('rejects an out-of-range magnitude', async () => {
    const errors = await validate(plainToInstance(FranchiseAdjustStockDto, { ...base, quantity: 2_000_000 }));
    expect(hasQuantityError(errors)).toBe(true);
  });

  it('accepts a negative integer (down-correction / loss)', async () => {
    const errors = await validate(plainToInstance(FranchiseAdjustStockDto, { ...base, quantity: -5 }));
    expect(hasQuantityError(errors)).toBe(false);
  });

  it('accepts a normal positive integer', async () => {
    const errors = await validate(plainToInstance(FranchiseAdjustStockDto, { ...base, quantity: 5 }));
    expect(hasQuantityError(errors)).toBe(false);
  });
});

// ── #13 — low-stock detection at the database ────────────────────────────────
describe('PrismaFranchiseInventoryRepository — low-stock via $queryRaw (#13)', () => {
  it('findLowStockItems filters at the DB and never bulk-fetches every stock row', async () => {
    const prisma: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ productId: 'p1', variantId: null, availableQty: 1, lowStockThreshold: 5 }]),
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', title: 'Ball' }]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      franchiseStock: { findMany: jest.fn() },
    };
    const repo = new PrismaFranchiseInventoryRepository(prisma);

    const res = await repo.findLowStockItems('fr1');

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.franchiseStock.findMany).not.toHaveBeenCalled();
    expect(res[0].product).toEqual({ id: 'p1', title: 'Ball' });
  });

  it('findStockByFranchise(lowStockOnly) reports the DB total, not the current page size', async () => {
    const prisma: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ productId: 'p1', variantId: null }]) // 1-row page
        .mockResolvedValueOnce([{ count: 42 }]), // true DB total
      product: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      franchiseStock: { findMany: jest.fn(), count: jest.fn() },
    };
    const repo = new PrismaFranchiseInventoryRepository(prisma);

    const res = await repo.findStockByFranchise('fr1', { page: 1, limit: 20, lowStockOnly: true });

    expect(res.total).toBe(42);
    expect(res.stocks).toHaveLength(1);
    // the broken path used Prisma findMany/count + a JS filter; the fix uses raw SQL
    expect(prisma.franchiseStock.findMany).not.toHaveBeenCalled();
    expect(prisma.franchiseStock.count).not.toHaveBeenCalled();
  });
});
