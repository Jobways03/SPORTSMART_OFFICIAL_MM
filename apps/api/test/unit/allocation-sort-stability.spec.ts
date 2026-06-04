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
 * After the fix, findMany carries an `id: 'asc'` ordering tier:
 *   - sellerProductMapping: orderBy { id: 'asc' }
 *   - franchiseCatalogMapping: orderBy [{ variantId: 'desc' }, { id: 'asc' }]
 *     (variant-specific rows first for dedup precedence; id-asc keeps
 *     the tied-score tiebreak deterministic).
 *
 * PR 12.7 — franchiseCatalogMapping gained the variant-priority primary
 * sort. The id-asc deterministic-tiebreak invariant is preserved as
 * the secondary key, which is what this spec guards.
 */

describe('SellerAllocationService — deterministic findMany order', () => {
  const makeService = () => {
    const prisma: any = {
      // Phase 64 — allocate() now checks product status before routing.
      product: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: 'ACTIVE', isDeleted: false }),
      },
      sellerProductMapping: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Phase 159m — franchise discovery first reads the pincode-to-franchise
      // territory map.
      franchisePincodeMapping: {
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
    // Phase 4 — coordinate lookups go through PostOfficeCacheService, not the
    // raw post_offices table. Phase 52 — reservation path writes to the ledger.
    const postOfficeCache: any = {
      lookup: jest.fn().mockResolvedValue({ latitude: 0, longitude: 0 }),
      lookupMany: jest.fn().mockResolvedValue(new Map()),
    };
    const stockLedger: any = { record: jest.fn().mockResolvedValue(undefined) };
    const svc = new SellerAllocationService(
      prisma,
      env,
      postOfficeCache,
      stockLedger,
    );
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
    // Phase 77 — the seller query gained the same variant-priority primary sort
    // as the franchise side (variant-specific rows first for dedup precedence),
    // with id-asc preserved as the deterministic tied-score tiebreak.
    expect(callArg.orderBy).toEqual([{ variantId: 'desc' }, { id: 'asc' }]);
  });

  it('franchise catalog findMany keeps id-asc as the deterministic tiebreak', async () => {
    const { svc, prisma } = makeService();

    await svc.allocate({
      productId: 'p1',
      customerPincode: '560001',
      quantity: 1,
    });

    expect(prisma.franchiseCatalogMapping.findMany).toHaveBeenCalled();
    const callArg = prisma.franchiseCatalogMapping.findMany.mock.calls[0][0];
    // The franchise query uses a compound sort: variant-specific rows
    // come first (so the dedup step keeps the variant-row, not the
    // product-row fallback), then id-asc keeps tied-score outcomes
    // deterministic. The spec asserts both layers are present and in
    // this order — flipping them would break dedup AND tiebreak.
    expect(callArg.orderBy).toEqual([
      { variantId: 'desc' },
      { id: 'asc' },
    ]);
  });
});
