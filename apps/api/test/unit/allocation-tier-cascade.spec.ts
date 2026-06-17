import 'reflect-metadata';
import { SellerAllocationService } from '../../src/modules/catalog/application/services/seller-allocation.service';

/**
 * Tiered-allocation cascade (2026-06-16). Proves the routing engine assigns by a
 * strict type priority — Retail → Franchise → D2C — through the real
 * allocate() pipeline:
 *
 *   - Retail is LOCAL ONLY (≤ RETAIL_LOCAL_RADIUS_KM, default 50km). An eligible
 *     retail seller wins over ANY franchise / D2C, even a closer one.
 *   - Franchise + D2C ship NATIONWIDE (no distance cap). Franchise outranks D2C.
 *   - If the only stock is a retail seller beyond the radius (and no franchise /
 *     D2C covers the pincode), the order is NOT serviceable.
 */

const MUMBAI = { latitude: 19.076, longitude: 72.877 }; // pincode 400001
const BANGALORE = { latitude: 12.97, longitude: 77.59 }; // franchise warehouse 560040
const DELHI = { latitude: 28.6, longitude: 77.2 }; // ~1150km from Mumbai (retail "far")

function sellerMapping(opts: {
  id: string;
  sellerType: 'RETAIL' | 'D2C';
  latitude: number;
  longitude: number;
}) {
  return {
    id: opts.id,
    sellerId: opts.id,
    productId: 'prod-1',
    variantId: null,
    isActive: true,
    approvalStatus: 'APPROVED',
    stockQty: 50,
    reservedQty: 0,
    dispatchSla: 2,
    latitude: opts.latitude,
    longitude: opts.longitude,
    pickupPincode: null,
    operationalPriority: 0,
    seller: {
      id: opts.id,
      sellerName: opts.id,
      sellerShopName: opts.id,
      status: 'ACTIVE',
      sellerType: opts.sellerType,
      fulfillmentHold: false,
    },
  };
}

function build(opts: { sellerMappings?: any[]; withFranchise?: boolean }) {
  const prisma: any = {
    product: {
      findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', isDeleted: false }),
    },
    sellerProductMapping: {
      findMany: jest.fn().mockResolvedValue(opts.sellerMappings ?? []),
    },
    sellerServiceArea: { findMany: jest.fn().mockResolvedValue([]) },
    franchiseCatalogMapping: {
      findMany: jest.fn().mockResolvedValue(
        opts.withFranchise
          ? [
              {
                id: 'cm-F',
                variantId: null,
                franchise: {
                  id: 'fr-1',
                  businessName: 'Franchise One',
                  status: 'ACTIVE',
                  warehousePincode: '560040',
                  isDeleted: false,
                },
              },
            ]
          : [],
      ),
    },
    franchiseStock: {
      findMany: jest.fn().mockResolvedValue(
        opts.withFranchise
          ? [{ franchiseId: 'fr-1', productId: 'prod-1', variantId: null, availableQty: 50 }]
          : [],
      ),
    },
    franchisePincodeMapping: { findMany: jest.fn().mockResolvedValue([]) },
    allocationLog: { create: jest.fn().mockResolvedValue({ id: 'log' }) },
  };

  const env: any = {
    // Defaults: RETAIL_LOCAL_RADIUS_KM=50, weights as in prod.
    getNumber: jest.fn((_k: string, fallback: number) => fallback),
    getString: jest.fn(() => ''),
  };
  const postOfficeCache: any = {
    lookup: jest.fn(async (pin: string) =>
      pin === '400001' ? MUMBAI : pin === '560040' ? BANGALORE : null,
    ),
    lookupMany: jest.fn().mockResolvedValue(new Map()),
  };
  const stockLedger: any = { record: jest.fn() };
  const svc = new SellerAllocationService(prisma, env, postOfficeCache, stockLedger);
  return { svc, prisma };
}

const allocate = (svc: any) =>
  svc.allocate({ productId: 'prod-1', customerPincode: '400001', quantity: 1, skipLog: true });

describe('Tiered allocation cascade — Retail → Franchise → D2C', () => {
  it('an eligible RETAIL seller (≤50km) wins over franchise AND D2C', async () => {
    const { svc, prisma } = build({
      sellerMappings: [
        sellerMapping({ id: 'retail-near', sellerType: 'RETAIL', ...{ latitude: 19.1, longitude: 72.9 } }), // ~3km
        sellerMapping({ id: 'd2c-near', sellerType: 'D2C', ...{ latitude: 19.0, longitude: 72.8 } }),
      ],
      withFranchise: true,
    });
    const res = await allocate(svc);
    expect(res.serviceable).toBe(true);
    // The cascade winner (primary) is the best RETAIL seller.
    expect(res.primary.tier).toBe('RETAIL');
    expect(res.primary.sellerId).toBe('retail-near');
    // Cross-tier fallback (2026-06-16): franchise + D2C are computed eagerly and
    // included in allEligible as the fallback chain — so the franchise query DOES
    // run now (no short-circuit), and allEligible spans all tiers.
    expect(prisma.franchiseCatalogMapping.findMany).toHaveBeenCalled();
    const tiers = res.allEligible.map((c: any) => c.tier);
    expect(tiers[0]).toBe('RETAIL'); // primary
    expect(tiers).toContain('FRANCHISE');
    expect(tiers).toContain('D2C');
    // …and they appear in strict cascade priority order:
    // every RETAIL precedes every FRANCHISE, which precedes every D2C.
    expect(tiers.lastIndexOf('RETAIL')).toBeLessThan(tiers.indexOf('FRANCHISE'));
    expect(tiers.lastIndexOf('FRANCHISE')).toBeLessThan(tiers.indexOf('D2C'));
  });

  it('retail too far → FRANCHISE wins over D2C (both nationwide)', async () => {
    const { svc, prisma } = build({
      sellerMappings: [
        sellerMapping({ id: 'retail-far', sellerType: 'RETAIL', ...DELHI }), // ~1150km > 50km
        sellerMapping({ id: 'd2c-near', sellerType: 'D2C', ...{ latitude: 19.0, longitude: 72.8 } }),
      ],
      withFranchise: true,
    });
    const res = await allocate(svc);
    expect(res.serviceable).toBe(true);
    expect(res.primary.tier).toBe('FRANCHISE');
    expect(prisma.franchiseCatalogMapping.findMany).toHaveBeenCalled();
  });

  it('retail too far + no franchise → D2C (nationwide) wins', async () => {
    const { svc } = build({
      sellerMappings: [
        sellerMapping({ id: 'retail-far', sellerType: 'RETAIL', ...DELHI }),
        sellerMapping({ id: 'd2c-far', sellerType: 'D2C', ...DELHI }), // far is fine — D2C nationwide
      ],
      withFranchise: false,
    });
    const res = await allocate(svc);
    expect(res.serviceable).toBe(true);
    expect(res.primary.tier).toBe('D2C');
    expect(res.primary.sellerId).toBe('d2c-far');
  });

  it('only a far retail seller (no franchise/D2C) → NOT serviceable', async () => {
    const { svc } = build({
      sellerMappings: [sellerMapping({ id: 'retail-far', sellerType: 'RETAIL', ...DELHI })],
      withFranchise: false,
    });
    const res = await allocate(svc);
    expect(res.serviceable).toBe(false);
    expect(res.reason).toBe('DISTANCE_EXCEEDED');
    expect(res.primary).toBeNull();
  });
});
