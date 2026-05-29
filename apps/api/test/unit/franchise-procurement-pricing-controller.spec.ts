import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminFranchiseProcurementPricingController } from '../../src/modules/franchise/presentation/controllers/admin-franchise-procurement-pricing.controller';
import { FranchiseProcurementPriceUpsertDto } from '../../src/modules/franchise/presentation/dtos/franchise-procurement-price-upsert.dto';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

/**
 * Phase 159l — per-franchise procurement-pricing controller hardening.
 * Covers audit #6 (status guard), #16 (cost-vs-price sanity), #8 (OCC),
 * #4/#13 (history + audit + event), #7/#14 (DTO bounds + change reason).
 */

const reqStub = (adminId = 'admin-1') =>
  ({
    adminId,
    headers: { 'user-agent': 'jest' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  }) as any;

function build(
  opts: {
    franchiseStatus?: string;
    sellingPrice?: number | null;
    existing?: { id: string; version: number; landedUnitCost: number } | null;
    casCount?: number;
  } = {},
) {
  const historyCreate = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: opts.casCount ?? 1 });
  const create = jest.fn().mockResolvedValue({ id: 'new-1' });
  const del = jest.fn().mockResolvedValue({});
  const finalRow = { id: opts.existing?.id ?? 'new-1', landedUnitCost: 10 };
  const price = opts.sellingPrice === undefined ? 1000 : opts.sellingPrice;

  const fppFindUnique = jest
    .fn()
    .mockResolvedValueOnce(opts.existing ?? null) // pre-read (OCC + old cost)
    .mockResolvedValue(finalRow); // post-tx re-fetch

  const prisma: any = {
    product: {
      findFirst: jest.fn().mockResolvedValue({ id: 'prod-1', basePrice: price }),
    },
    productVariant: {
      findFirst: jest.fn().mockResolvedValue({ id: 'var-1', price }),
    },
    franchisePartner: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'fr-1', status: opts.franchiseStatus ?? 'ACTIVE' }),
    },
    franchiseProcurementPrice: {
      findUnique: fppFindUnique,
      create,
      updateMany,
      delete: del,
    },
    franchiseProcurementPriceHistory: { create: historyCreate },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const ctrl = new AdminFranchiseProcurementPricingController(
    prisma,
    audit,
    eventBus,
  );
  return { ctrl, prisma, historyCreate, updateMany, create, del, audit, eventBus };
}

const baseDto = (over: Partial<any> = {}) => ({
  productId: 'prod-1',
  variantId: 'var-1',
  landedUnitCost: 10,
  ...over,
});

describe('FranchiseProcurementPriceUpsertDto validation', () => {
  const errsFor = async (obj: any, prop: string) =>
    (await validate(plainToInstance(FranchiseProcurementPriceUpsertDto, obj))).filter(
      (e) => e.property === prop,
    );

  it('rejects landedUnitCost above the 1,000,000 ceiling (#7)', async () => {
    expect((await errsFor({ productId: 'p', landedUnitCost: 2_000_000 }, 'landedUnitCost')).length).toBeGreaterThan(0);
  });
  it('accepts a normal landedUnitCost', async () => {
    expect(await errsFor({ productId: 'p', landedUnitCost: 499.5 }, 'landedUnitCost')).toHaveLength(0);
  });
  it('rejects an unknown changeReason (#14)', async () => {
    expect((await errsFor({ productId: 'p', landedUnitCost: 5, changeReason: 'BOGUS' }, 'changeReason')).length).toBeGreaterThan(0);
  });
  it('accepts a known changeReason + expectedVersion', async () => {
    expect(await errsFor({ productId: 'p', landedUnitCost: 5, changeReason: 'RENEGOTIATION', expectedVersion: 3 }, 'changeReason')).toHaveLength(0);
  });
});

describe('AdminFranchiseProcurementPricingController.upsert', () => {
  it('blocks writes for a non-ACTIVE/APPROVED franchise (#6)', async () => {
    const { ctrl } = build({ franchiseStatus: 'DEACTIVATED' });
    await expect(
      ctrl.upsert(reqStub(), 'fr-1', baseDto() as any),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('rejects a cost above 1.5x the selling price (#16)', async () => {
    const { ctrl } = build({ sellingPrice: 100 });
    await expect(
      ctrl.upsert(reqStub(), 'fr-1', baseDto({ landedUnitCost: 200 }) as any),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects a stale expectedVersion (#8 optimistic concurrency)', async () => {
    const { ctrl } = build({ existing: { id: 'o-1', version: 5, landedUnitCost: 8 } });
    await expect(
      ctrl.upsert(reqStub(), 'fr-1', baseDto({ expectedVersion: 3 }) as any),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('throws Conflict when the version-CAS matches 0 rows (concurrent write)', async () => {
    const { ctrl } = build({
      existing: { id: 'o-1', version: 2, landedUnitCost: 8 },
      casCount: 0,
    });
    await expect(
      ctrl.upsert(reqStub(), 'fr-1', baseDto({ expectedVersion: 2 }) as any),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('create path: writes row + history(UPSERT_CREATE) + audit + event (#4/#13)', async () => {
    const { ctrl, create, historyCreate, audit, eventBus } = build({ existing: null });
    await ctrl.upsert(reqStub(), 'fr-1', baseDto() as any);
    expect(create).toHaveBeenCalled();
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'UPSERT_CREATE' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_PROCUREMENT_PRICE_SET' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'franchise.procurement_pricing_changed' }),
    );
  });

  it('update path: version-CAS update + history(UPSERT_UPDATE)', async () => {
    const { ctrl, updateMany, historyCreate } = build({
      existing: { id: 'o-1', version: 2, landedUnitCost: 8 },
    });
    await ctrl.upsert(reqStub(), 'fr-1', baseDto({ expectedVersion: 2 }) as any);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o-1', version: 2 } }),
    );
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'UPSERT_UPDATE' }) }),
    );
  });
});

describe('AdminFranchiseProcurementPricingController.remove', () => {
  it('404s when the price row belongs to a different franchise', async () => {
    const { ctrl, prisma } = build();
    prisma.franchiseProcurementPrice.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'o-1', franchiseId: 'OTHER', productId: 'prod-1', variantId: 'var-1', landedUnitCost: 8 });
    await expect(
      ctrl.remove(reqStub(), 'fr-1', 'o-1'),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('delete path: deletes + writes history(DELETE) + audit + event', async () => {
    const { ctrl, prisma, del, historyCreate, audit, eventBus } = build();
    prisma.franchiseProcurementPrice.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'o-1', franchiseId: 'fr-1', productId: 'prod-1', variantId: 'var-1', landedUnitCost: 8 });
    await ctrl.remove(reqStub(), 'fr-1', 'o-1');
    expect(del).toHaveBeenCalledWith({ where: { id: 'o-1' } });
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DELETE' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_PROCUREMENT_PRICE_REMOVED' }),
    );
    expect(eventBus.publish).toHaveBeenCalled();
  });
});
