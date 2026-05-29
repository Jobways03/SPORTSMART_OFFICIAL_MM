import 'reflect-metadata';
import { ProcurementService } from '../../src/modules/franchise/application/services/procurement.service';
import { PrismaProcurementRepository } from '../../src/modules/franchise/infrastructure/repositories/prisma-procurement.repository';
import { BadRequestAppException } from '../../src/core/exceptions';

/**
 * Phase 159p — Franchise Procurement Request Flow audit remediation.
 *   #3  approvedQty must not exceed requestedQty
 *   #10 dispatchedQty must not exceed approvedQty (partial dispatch)
 *   #12 every transition writes a ProcurementRequestEvent history row
 *   #8  settle posts a PROCUREMENT_COST (principal) ledger row
 *   #14 calculateTotals uses ONE denominator (finalPayable == approved + fee)
 */

function makeService(over: { request?: any; itemsById?: Record<string, any> } = {}) {
  const procurementRepo: any = {
    findById: jest.fn().mockResolvedValue(over.request ?? null),
    findByIdWithItems: jest.fn().mockResolvedValue(over.request ?? null),
    findItemById: jest.fn(async (id: string) => over.itemsById?.[id] ?? null),
    updateItem: jest.fn().mockResolvedValue(undefined),
    calculateTotals: jest.fn().mockResolvedValue({
      totalApprovedAmount: 0,
      procurementFeeAmount: 0,
      finalPayableAmount: 0,
    }),
    update: jest.fn(async (_id: string, data: any) => ({ id: 'req-1', ...data })),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const commissionService: any = {
    recordProcurementCost: jest.fn().mockResolvedValue({ id: 'led-cost' }),
    recordProcurementFee: jest.fn().mockResolvedValue({ id: 'led-fee' }),
  };
  const prisma: any = {
    procurementRequestEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const env: any = { getNumber: jest.fn().mockReturnValue(48) };

  const service = new ProcurementService(
    procurementRepo,
    {} as any, // catalogRepo
    {} as any, // franchiseRepo
    {} as any, // inventoryService
    commissionService,
    eventBus,
    logger,
    prisma,
    env,
  );
  return { service, procurementRepo, prisma, commissionService };
}

describe('approveRequest — #3 approvedQty <= requestedQty', () => {
  const request = {
    id: 'req-1',
    franchiseId: 'fr-1',
    requestNumber: 'SM-PO-1',
    status: 'SUBMITTED',
    procurementFeeRate: 10,
    items: [{ id: 'item-1', productId: 'p1', variantId: null, requestedQty: 10 }],
  };

  it('rejects an over-approval (20 approved for 10 requested)', async () => {
    const { service } = makeService({
      request,
      itemsById: { 'item-1': { id: 'item-1', procurementRequestId: 'req-1', requestedQty: 10 } },
    });
    await expect(
      service.approveRequest('admin-1', 'req-1', [
        { itemId: 'item-1', approvedQty: 20, landedUnitCost: 100 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('allows approval up to requestedQty AND writes an APPROVED history row (#12)', async () => {
    const { service, prisma } = makeService({
      request,
      itemsById: { 'item-1': { id: 'item-1', procurementRequestId: 'req-1', requestedQty: 10 } },
    });
    await service.approveRequest('admin-1', 'req-1', [
      { itemId: 'item-1', approvedQty: 10, landedUnitCost: 100 },
    ]);
    expect(prisma.procurementRequestEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'APPROVED', toStatus: 'APPROVED', actorType: 'ADMIN' }),
      }),
    );
  });
});

describe('markDispatched — #10 partial dispatch', () => {
  const request = {
    id: 'req-1',
    franchiseId: 'fr-1',
    requestNumber: 'SM-PO-1',
    status: 'APPROVED',
    items: [{ id: 'item-1', status: 'APPROVED', approvedQty: 100 }],
  };

  it('rejects dispatchedQty greater than approvedQty', async () => {
    const { service } = makeService({ request });
    await expect(
      service.markDispatched('admin-1', 'req-1', {}, [{ itemId: 'item-1', dispatchedQty: 200 }]),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('dispatches a partial quantity (80 of 100)', async () => {
    const { service, procurementRepo } = makeService({ request });
    await service.markDispatched('admin-1', 'req-1', {}, [{ itemId: 'item-1', dispatchedQty: 80 }]);
    expect(procurementRepo.updateItem).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ status: 'DISPATCHED', dispatchedQty: 80 }),
      expect.anything(),
    );
  });

  it('defaults to full approvedQty when no per-item override is given', async () => {
    const { service, procurementRepo } = makeService({ request });
    await service.markDispatched('admin-1', 'req-1', {});
    expect(procurementRepo.updateItem).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ dispatchedQty: 100 }),
      expect.anything(),
    );
  });
});

describe('settleRequest — #8 principal-cost ledger row', () => {
  it('posts a PROCUREMENT_COST principal row in addition to the fee', async () => {
    const { service, commissionService } = makeService({
      request: {
        id: 'req-1',
        franchiseId: 'fr-1',
        requestNumber: 'SM-PO-1',
        status: 'RECEIVED',
        totalApprovedAmount: 5000,
        procurementFeeRate: 10,
        finalPayableAmount: 5500,
      },
    });
    await service.settleRequest('admin-1', 'req-1');
    expect(commissionService.recordProcurementCost).toHaveBeenCalledWith(
      expect.objectContaining({ franchiseId: 'fr-1', procurementRequestId: 'req-1', principalAmount: 5000 }),
    );
  });
});

describe('PrismaProcurementRepository.calculateTotals — #14 single denominator', () => {
  function repoWith(items: any[]) {
    const prisma: any = {
      procurementRequest: { findUnique: jest.fn().mockResolvedValue({ id: 'req-1', items }) },
    };
    return new PrismaProcurementRepository(prisma);
  }

  it('once received, all three aggregates use receivedQty (finalPayable == approved + fee)', async () => {
    // approved 10, received 5; landed 100, fee 10, final 110.
    const repo = repoWith([
      {
        approvedQty: 10,
        receivedQty: 5,
        landedUnitCost: 100,
        procurementFeePerUnit: 10,
        finalUnitCostToFranchise: 110,
      },
    ]);
    const t = await repo.calculateTotals('req-1');
    // received denominator (5) for all three
    expect(Number(t.totalApprovedAmount)).toBe(500);
    expect(Number(t.procurementFeeAmount)).toBe(50);
    expect(Number(t.finalPayableAmount)).toBe(550);
    // the invariant the old mixed-denominator code violated
    expect(Number(t.finalPayableAmount)).toBe(
      Number(t.totalApprovedAmount) + Number(t.procurementFeeAmount),
    );
  });

  it('before any receipt, all three use approvedQty', async () => {
    const repo = repoWith([
      {
        approvedQty: 10,
        receivedQty: 0,
        landedUnitCost: 100,
        procurementFeePerUnit: 10,
        finalUnitCostToFranchise: 110,
      },
    ]);
    const t = await repo.calculateTotals('req-1');
    expect(Number(t.totalApprovedAmount)).toBe(1000);
    expect(Number(t.finalPayableAmount)).toBe(
      Number(t.totalApprovedAmount) + Number(t.procurementFeeAmount),
    );
  });
});
