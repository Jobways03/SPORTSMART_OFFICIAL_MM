import 'reflect-metadata';
import { FranchiseOrdersService } from '../../src/modules/franchise/application/services/franchise-orders.service';

/**
 * Regression test for partial-return commission reversal in
 * FranchiseOrdersService.initiateReturn.
 *
 * Before: the reversal passed `Number(originalEntry.franchiseEarning)`
 * — the FULL sub-order franchise earning — regardless of how much of
 * the sub-order the customer actually returned. Partial counter-returns
 * over-credited the platform and under-paid the franchise on every
 * partial return.
 *
 * After: the reversal is proportional to the returned gross value
 * divided by the sub-order gross value. Full returns still fully
 * reverse; partial returns reverse only their share.
 */

describe('FranchiseOrdersService.initiateReturn — proportional commission reversal', () => {
  const buildService = () => {
    const recordReturnReversal = jest
      .fn()
      .mockResolvedValue({ id: 'ledger-reversal-1' });
    const commissionService: any = { recordReturnReversal };

    const inventoryService: any = {
      recordReturn: jest.fn().mockResolvedValue(undefined),
    };

    // Sub-order: 3 items, each quantity=1, unit prices 100/200/300. Total gross = 600.
    // Original franchise earning = 120 (20% franchise share).
    const subOrder = {
      id: 'sub-1',
      franchiseId: 'fr-A',
      fulfillmentNodeType: 'FRANCHISE',
      fulfillmentStatus: 'DELIVERED',
      returnWindowEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      items: [
        { id: 'oi-1', productId: 'p1', variantId: null, quantity: 1, unitPrice: '100' },
        { id: 'oi-2', productId: 'p2', variantId: null, quantity: 1, unitPrice: '200' },
        { id: 'oi-3', productId: 'p3', variantId: null, quantity: 1, unitPrice: '300' },
      ],
      masterOrder: {},
    };

    const originalEntry = {
      id: 'ledger-orig-1',
      franchiseEarning: '120.00', // Decimal comes back as string from Prisma
    };

    const prisma: any = {
      subOrder: {
        findUnique: jest.fn().mockResolvedValue(subOrder),
        update: jest.fn().mockResolvedValue({}),
      },
      franchiseFinanceLedger: {
        findFirst: jest.fn().mockResolvedValue(originalEntry),
      },
    };

    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Constructor: (prisma, inventoryService, commissionService,
    // catalogFacade, eventBus, logger). initiateReturn doesn't touch
    // catalogFacade, so an empty stub is fine.
    const svc = new FranchiseOrdersService(
      prisma as any,
      inventoryService as any,
      commissionService as any,
      {} as any, // catalogFacade
      eventBus,
      logger,
    );

    return { svc, recordReturnReversal };
  };

  it('reverses 1/3 of franchise earning when only the ₹200 item (of a ₹600 order) is returned', async () => {
    const { svc, recordReturnReversal } = buildService();
    await svc.initiateReturn('sub-1', {
      items: [{ orderItemId: 'oi-2', quantity: 1, reason: 'size' }],
      initiatedBy: 'FRANCHISE',
      initiatorId: 'fr-A',
    });

    // returnedGross = 200; subOrderGross = 600; proportion = 1/3
    // reversal = 120 × (1/3) = 40
    expect(recordReturnReversal).toHaveBeenCalledTimes(1);
    const args = recordReturnReversal.mock.calls[0][0];
    expect(args.reversalAmount).toBeCloseTo(40, 2);
    expect(args.subOrderId).toBe('sub-1');
    expect(args.franchiseId).toBe('fr-A');
  });

  it('reverses the full franchise earning when every item is returned', async () => {
    const { svc, recordReturnReversal } = buildService();
    await svc.initiateReturn('sub-1', {
      items: [
        { orderItemId: 'oi-1', quantity: 1, reason: 'defect' },
        { orderItemId: 'oi-2', quantity: 1, reason: 'defect' },
        { orderItemId: 'oi-3', quantity: 1, reason: 'defect' },
      ],
      initiatedBy: 'FRANCHISE',
      initiatorId: 'fr-A',
    });

    // returnedGross = 600; subOrderGross = 600; proportion = 1.0
    // reversal = 120 × 1.0 = 120
    const args = recordReturnReversal.mock.calls[0][0];
    expect(args.reversalAmount).toBeCloseTo(120, 2);
  });

  it('reverses half when the ₹300 item is returned (half of ₹600 gross)', async () => {
    const { svc, recordReturnReversal } = buildService();
    await svc.initiateReturn('sub-1', {
      items: [{ orderItemId: 'oi-3', quantity: 1, reason: 'damaged' }],
      initiatedBy: 'FRANCHISE',
      initiatorId: 'fr-A',
    });

    // returnedGross = 300; subOrderGross = 600; proportion = 0.5
    // reversal = 120 × 0.5 = 60
    const args = recordReturnReversal.mock.calls[0][0];
    expect(args.reversalAmount).toBeCloseTo(60, 2);
  });
});
