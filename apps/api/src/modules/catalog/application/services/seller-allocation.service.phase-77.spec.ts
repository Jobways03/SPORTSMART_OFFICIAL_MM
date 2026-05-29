// Phase 77 (2026-05-22) — allocator hardening.
//
// Covers:
//   Gap #3  — variant-fallback parity: seller path uses
//             `OR [{variantId}, {variantId: null}]` (was strict
//             equality, deflected to franchise when only
//             product-level mappings existed)
//   Gap #13 — deterministic tiebreak on equal score (by mappingId)
//   Gap #20 — public response sanitisation (covered in controller spec)
//
// The N+1 batching (Gap #9/#22) is verified at the query-count
// level via mock call counts; the AllocationCandidate persistence
// (Gap #7) is verified by the create-call shape.

import { SellerAllocationService } from './seller-allocation.service';

function makeSvc(opts: {
  sellerMappings?: any[];
  catalogMappings?: any[];
  stockRows?: any[];
  product?: any;
  customerCoords?: { latitude: number; longitude: number } | null;
  envMaxDistance?: number;
} = {}) {
  const productFindUnique = jest.fn().mockResolvedValue(
    opts.product ?? { status: 'ACTIVE', isDeleted: false },
  );
  const sellerMappingFindMany = jest.fn().mockResolvedValue(opts.sellerMappings ?? []);
  const catalogMappingFindMany = jest.fn().mockResolvedValue(opts.catalogMappings ?? []);
  const stockFindMany = jest.fn().mockResolvedValue(opts.stockRows ?? []);
  const serviceAreaFindMany = jest.fn().mockResolvedValue([]);
  const allocationLogCreate = jest.fn().mockResolvedValue({ id: 'log-1' });

  const prisma: any = {
    product: { findUnique: productFindUnique },
    sellerProductMapping: { findMany: sellerMappingFindMany },
    franchiseCatalogMapping: { findMany: catalogMappingFindMany },
    franchisePincodeMapping: { findMany: jest.fn().mockResolvedValue([]) },
    franchiseStock: { findMany: stockFindMany, findFirst: jest.fn() },
    sellerServiceArea: { findMany: serviceAreaFindMany },
    allocationLog: { create: allocationLogCreate },
  };

  const env: any = {
    getNumber: (k: string, fb: number) => {
      if (k === 'ROUTING_MAX_DISTANCE_KM' && opts.envMaxDistance !== undefined) {
        return opts.envMaxDistance;
      }
      return fb;
    },
  };
  const postOfficeCache: any = {
    lookup: jest.fn().mockResolvedValue(
      opts.customerCoords ?? { latitude: 13.0, longitude: 80.0 },
    ),
  };
  const stockLedger: any = { recordReservation: jest.fn() };

  const svc = new SellerAllocationService(prisma, env, postOfficeCache, stockLedger);
  return {
    svc,
    sellerMappingFindMany,
    catalogMappingFindMany,
    stockFindMany,
    allocationLogCreate,
  };
}

describe('SellerAllocationService.allocate (Phase 77)', () => {
  it('Gap #3 — seller path falls back to product-level (variantId=null) mapping when no variant-specific exists', async () => {
    const { svc, sellerMappingFindMany } = makeSvc({
      sellerMappings: [
        {
          id: 'm-1',
          sellerId: 's-1',
          productId: 'p-1',
          variantId: null,
          stockQty: 10,
          reservedQty: 0,
          latitude: 13.0,
          longitude: 80.0,
          dispatchSla: 1,
          seller: { id: 's-1', sellerName: 'Shop A', sellerShopName: 'A', status: 'ACTIVE' },
        },
      ],
    });
    const result = await svc.allocate({
      productId: 'p-1',
      variantId: 'v-1',
      customerPincode: '500001',
      quantity: 1,
    });
    expect(result.serviceable).toBe(true);
    // The findMany query carries the OR clause now.
    const callArgs = sellerMappingFindMany.mock.calls[0]![0];
    expect(callArgs.where.OR).toEqual([
      { variantId: 'v-1' },
      { variantId: null },
    ]);
  });

  it('Gap #3 — dedupes by sellerId when both variant + product-level rows match', async () => {
    const { svc } = makeSvc({
      sellerMappings: [
        // Variant-specific (orderBy: variantId DESC puts this first)
        {
          id: 'm-variant',
          sellerId: 's-1',
          productId: 'p-1',
          variantId: 'v-1',
          stockQty: 5,
          reservedQty: 0,
          latitude: 13.0,
          longitude: 80.0,
          dispatchSla: 1,
          seller: { id: 's-1', sellerName: 'A', sellerShopName: 'A', status: 'ACTIVE' },
        },
        // Product-level fallback for the same seller
        {
          id: 'm-product',
          sellerId: 's-1',
          productId: 'p-1',
          variantId: null,
          stockQty: 100,
          reservedQty: 0,
          latitude: 13.0,
          longitude: 80.0,
          dispatchSla: 1,
          seller: { id: 's-1', sellerName: 'A', sellerShopName: 'A', status: 'ACTIVE' },
        },
      ],
    });
    const result = await svc.allocate({
      productId: 'p-1',
      variantId: 'v-1',
      customerPincode: '500001',
      quantity: 1,
    });
    expect(result.serviceable).toBe(true);
    // Only the variant-specific row should appear in candidates.
    expect(result.allEligible).toHaveLength(1);
    expect(result.allEligible[0]!.mappingId).toBe('m-variant');
  });

  it('Gap #13 — equal-score candidates are tiebroken by mappingId ASC (deterministic)', async () => {
    // Two sellers with identical distance + stock + sla → same score.
    const { svc } = makeSvc({
      sellerMappings: [
        {
          id: 'm-zzz',
          sellerId: 's-1',
          productId: 'p-1',
          variantId: null,
          stockQty: 10,
          reservedQty: 0,
          latitude: 13.0,
          longitude: 80.0,
          dispatchSla: 1,
          seller: { id: 's-1', sellerName: 'A', sellerShopName: 'A', status: 'ACTIVE' },
        },
        {
          id: 'm-aaa',
          sellerId: 's-2',
          productId: 'p-1',
          variantId: null,
          stockQty: 10,
          reservedQty: 0,
          latitude: 13.0,
          longitude: 80.0,
          dispatchSla: 1,
          seller: { id: 's-2', sellerName: 'B', sellerShopName: 'B', status: 'ACTIVE' },
        },
      ],
    });
    const result = await svc.allocate({
      productId: 'p-1',
      customerPincode: '500001',
      quantity: 1,
    });
    expect(result.serviceable).toBe(true);
    // Tiebreak: 'm-aaa' < 'm-zzz' lexicographically → m-aaa wins.
    expect(result.primary!.mappingId).toBe('m-aaa');
  });

  it('Gap #9/#22 — findEligibleFranchises uses batched findMany, not per-iteration findFirst', async () => {
    const { svc, stockFindMany } = makeSvc({
      sellerMappings: [],
      catalogMappings: Array.from({ length: 10 }, (_, i) => ({
        id: `cm-${i}`,
        variantId: null,
        franchise: {
          id: `f-${i}`,
          businessName: `Franchise ${i}`,
          status: 'ACTIVE',
          warehousePincode: '500001',
          isDeleted: false,
        },
      })),
      stockRows: Array.from({ length: 10 }, (_, i) => ({
        franchiseId: `f-${i}`,
        productId: 'p-1',
        variantId: null,
        availableQty: 5,
      })),
    });
    await svc.allocate({
      productId: 'p-1',
      customerPincode: '500001',
      quantity: 1,
    });
    // Pre-Phase-77: 10 catalog mappings × 2 findFirst (variant +
    // wildcard) = 20+ stock queries. Phase 77: 1 batched findMany.
    expect(stockFindMany).toHaveBeenCalledTimes(1);
  });

  it('Gap #7 — AllocationLog write includes candidates nested-create', async () => {
    const { svc, allocationLogCreate } = makeSvc({
      sellerMappings: [
        {
          id: 'm-1',
          sellerId: 's-1',
          productId: 'p-1',
          variantId: null,
          stockQty: 10,
          reservedQty: 0,
          latitude: 13.0,
          longitude: 80.0,
          dispatchSla: 1,
          seller: { id: 's-1', sellerName: 'A', sellerShopName: 'A', status: 'ACTIVE' },
        },
      ],
    });
    await svc.allocate({
      productId: 'p-1',
      customerPincode: '500001',
      quantity: 1,
    });
    expect(allocationLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidates: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({
                rank: 1,
                mappingId: 'm-1',
                nodeType: 'SELLER',
              }),
            ]),
          }),
        }),
      }),
    );
  });
});
