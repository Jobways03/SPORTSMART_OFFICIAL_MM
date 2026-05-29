import 'reflect-metadata';
import { SellerAllocationService } from '../../src/modules/catalog/application/services/seller-allocation.service';

/**
 * Phase 159m — proves the routing engine honours admin pincode→franchise
 * territory mappings (supplement mode), exercised through the real
 * previewServiceability → allocate → findEligibleFranchises path.
 *
 *   - pincode HAS active mapping(s)  → only mapped franchises are eligible,
 *     ranked by priority.
 *   - pincode has NO mapping         → distance-based discovery (all franchises).
 */
const COORDS = { latitude: 12.97, longitude: 77.59 };

function build(opts: { pincodeMappings: Array<{ id: string; franchiseId: string; priority: number }> }) {
  const franchise = (id: string, name: string) => ({
    id,
    businessName: name,
    status: 'ACTIVE',
    warehousePincode: '560040',
    isDeleted: false,
  });

  const prisma: any = {
    product: {
      findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', isDeleted: false }),
    },
    // No sellers — isolate the franchise territory logic.
    sellerProductMapping: { findMany: jest.fn().mockResolvedValue([]) },
    sellerServiceArea: { findMany: jest.fn().mockResolvedValue([]) },
    // Two franchises both carry the product + stock.
    franchiseCatalogMapping: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'cm-A', variantId: null, franchise: franchise('fr-A', 'Franchise A') },
        { id: 'cm-B', variantId: null, franchise: franchise('fr-B', 'Franchise B') },
      ]),
    },
    franchiseStock: {
      findMany: jest.fn().mockResolvedValue([
        { franchiseId: 'fr-A', productId: 'prod-1', variantId: null, availableQty: 50 },
        { franchiseId: 'fr-B', productId: 'prod-1', variantId: null, availableQty: 50 },
      ]),
    },
    franchisePincodeMapping: {
      findMany: jest.fn().mockResolvedValue(opts.pincodeMappings),
    },
  };

  const env: any = {
    getNumber: jest.fn((_k: string, fallback: number) => fallback),
    getString: jest.fn(() => ''),
  };
  const postOfficeCache: any = { lookup: jest.fn().mockResolvedValue(COORDS) };
  const stockLedger: any = { record: jest.fn() };

  const svc = new SellerAllocationService(prisma, env, postOfficeCache, stockLedger);
  return { svc, prisma };
}

describe('Pincode→franchise territory routing (Phase 159m)', () => {
  const preview = (svc: any) =>
    svc.previewServiceability({ productId: 'prod-1', customerPincode: '560001', quantity: 1 });

  it('no mapping for the pincode → both franchises eligible (distance fallback)', async () => {
    const { svc } = build({ pincodeMappings: [] });
    const res = await preview(svc);
    const ids = res.allEligible.map((c: any) => c.franchiseId).sort();
    expect(ids).toEqual(['fr-A', 'fr-B']);
  });

  it('pincode mapped to only Franchise A → Franchise B is excluded (territory enforced)', async () => {
    const { svc } = build({
      pincodeMappings: [{ id: 'pm-A', franchiseId: 'fr-A', priority: 100 }],
    });
    const res = await preview(svc);
    const ids = res.allEligible.map((c: any) => c.franchiseId);
    expect(ids).toEqual(['fr-A']);
    expect(res.allEligible[0].pincodeMappingId).toBe('pm-A');
  });

  it('both mapped → higher-priority franchise ranks first + carries its mappingId', async () => {
    const { svc } = build({
      pincodeMappings: [
        { id: 'pm-A', franchiseId: 'fr-A', priority: 30 },
        { id: 'pm-B', franchiseId: 'fr-B', priority: 90 },
      ],
    });
    const res = await preview(svc);
    expect(res.allEligible).toHaveLength(2);
    // fr-B (priority 90) outranks fr-A (priority 30) — distance/stock are equal.
    expect(res.primary.franchiseId).toBe('fr-B');
    expect(res.primary.pincodeMappingId).toBe('pm-B');
  });
});
