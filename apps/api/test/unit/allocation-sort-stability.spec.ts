import 'reflect-metadata';
import { SellerAllocationService } from '../../src/modules/catalog/application/services/seller-allocation.service';

/**
 * Regression test for tied-score routing stability.
 *
 * JavaScript's Array.sort is stable (ES2019+), so when two candidates have
 * equal scores the order they land in is the input order. Before the fix,
 * `findMany` had no `orderBy` so input order was DB-row order — not
 * guaranteed stable across queries. Two concurrent allocate() calls could
 * pick different sellers when scores tied, breaking deterministic routing.
 *
 * After the fix, findMany carries `orderBy: { id: 'asc' }` for both
 * sellerProductMapping and franchiseCatalogMapping queries.
 */

describe('SellerAllocationService — deterministic findMany order', () => {
  const makeService = () => {
    const prisma: any = {
      postOffice: {
        findFirst: jest.fn().mockResolvedValue({ latitude: 0, longitude: 0 }),
      },
      sellerProductMapping: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      franchiseCatalogMapping: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sellerServiceArea: { findMany: jest.fn().mockResolvedValue([]) },
      franchiseStock: { findMany: jest.fn().mockResolvedValue([]) },
      allocationLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const env: any = {
      getNumber: (_k: string, d: number) => d,
    };
    const svc = new SellerAllocationService(prisma, env);
    return { svc, prisma };
  };

  it('seller mapping findMany uses orderBy id asc', async () => {
    const { svc, prisma } = makeService();

    await svc.allocate({
      productId: 'p1',
      customerPincode: '560001',
      quantity: 1,
    });

    expect(prisma.sellerProductMapping.findMany).toHaveBeenCalled();
    const callArg = prisma.sellerProductMapping.findMany.mock.calls[0][0];
    expect(callArg.orderBy).toEqual({ id: 'asc' });
  });

  it('franchise catalog findMany uses orderBy id asc', async () => {
    const { svc, prisma } = makeService();

    await svc.allocate({
      productId: 'p1',
      customerPincode: '560001',
      quantity: 1,
    });

    expect(prisma.franchiseCatalogMapping.findMany).toHaveBeenCalled();
    const callArg = prisma.franchiseCatalogMapping.findMany.mock.calls[0][0];
    expect(callArg.orderBy).toEqual({ id: 'asc' });
  });
});
