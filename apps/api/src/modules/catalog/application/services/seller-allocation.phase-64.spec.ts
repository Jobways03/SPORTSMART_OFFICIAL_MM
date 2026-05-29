/**
 * Phase 64 (2026-05-22) — pins the allocator hardening from the
 * serviceability audit:
 *
 *   - Typed ServiceabilityReason on every result (audit Gap #16).
 *   - Pincode format validation rejects garbage at the entry
 *     point (audit Gap #19).
 *   - Product-status gate (audit Gap #27).
 *   - Distance cap ROUTING_MAX_DISTANCE_KM filters out far
 *     candidates (audit Gap #8).
 *   - Null-distance candidates instead of 999km placeholder
 *     (audit Gap #9).
 *   - previewServiceability skips AllocationLog write (audit
 *     Gaps #3 + #5).
 */

import 'reflect-metadata';
import { SellerAllocationService } from './seller-allocation.service';

type Mocks = ReturnType<typeof buildMocks>;

function buildMocks(opts: {
  product?: any;
  sellerMappings?: any[];
  serviceAreas?: any[];
  postOffice?: any;
  envMaxDistance?: number;
} = {}) {
  const prisma: any = {
    product: {
      findUnique: jest.fn().mockResolvedValue(
        // Explicit null (test case) → return null; omitted → default ACTIVE.
        'product' in opts ? opts.product : { status: 'ACTIVE', isDeleted: false },
      ),
    },
    sellerProductMapping: {
      findMany: jest.fn().mockResolvedValue(opts.sellerMappings ?? []),
    },
    sellerServiceArea: {
      findMany: jest.fn().mockResolvedValue(opts.serviceAreas ?? []),
    },
    franchiseCatalogMapping: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    franchisePincodeMapping: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    franchiseStock: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    postOffice: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    allocationLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
  };
  const envService: any = {
    getNumber: (key: string, fallback: number) => {
      if (key === 'ROUTING_MAX_DISTANCE_KM') {
        return opts.envMaxDistance ?? fallback;
      }
      return fallback;
    },
  };
  // postOfficeCache.lookup: opts.postOffice is what the customer
  // pincode resolves to.
  const postOfficeCache: any = {
    lookup: jest.fn().mockResolvedValue(opts.postOffice ?? null),
    lookupMany: jest.fn().mockResolvedValue(new Map()),
  };
  const stockLedger: any = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new SellerAllocationService(
    prisma,
    envService,
    postOfficeCache,
    stockLedger,
  );
  return { svc, prisma, envService, postOfficeCache, stockLedger };
}

const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const VARIANT_ID = '00000000-0000-4000-8000-000000000002';
const SELLER_ID = 'seller-1';

function activeSellerMapping(over: any = {}) {
  return {
    id: 'mapping-1',
    sellerId: SELLER_ID,
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    isActive: true,
    approvalStatus: 'APPROVED',
    stockQty: 10,
    reservedQty: 0,
    dispatchSla: 2,
    latitude: null,
    longitude: null,
    pickupPincode: null,
    seller: { id: SELLER_ID, sellerName: 'Seller 1', sellerShopName: 'Shop 1', status: 'ACTIVE' },
    ...over,
  };
}

// ─── Gap #19: pincode format / PostOffice miss ────────────────────────

describe('allocate pincode validation (Phase 64 — Gap #19)', () => {
  it('rejects malformed pincode with PINCODE_UNKNOWN', async () => {
    const { svc } = buildMocks();
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      customerPincode: 'abc123',
      quantity: 1,
    });
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe('PINCODE_UNKNOWN');
  });

  it('rejects when PostOffice has no coords for the pincode', async () => {
    const { svc } = buildMocks({
      postOffice: null, // cache miss
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      customerPincode: '999999',
      quantity: 1,
    });
    expect(result.reason).toBe('PINCODE_UNKNOWN');
  });
});

// ─── Gap #27: product status ─────────────────────────────────────────

describe('allocate product status (Phase 64 — Gap #27)', () => {
  it('rejects PAUSED product with PRODUCT_INACTIVE', async () => {
    const { svc } = buildMocks({
      product: { status: 'PAUSED', isDeleted: false },
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.reason).toBe('PRODUCT_INACTIVE');
  });

  it('rejects soft-deleted product with PRODUCT_INACTIVE', async () => {
    const { svc } = buildMocks({
      product: { status: 'ACTIVE', isDeleted: true },
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.reason).toBe('PRODUCT_INACTIVE');
  });

  it('rejects missing product with PRODUCT_INACTIVE', async () => {
    const { svc } = buildMocks({ product: null });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.reason).toBe('PRODUCT_INACTIVE');
  });
});

// ─── Gap #16: typed reasons when no candidates ─────────────────────────

describe('allocate typed reasons (Phase 64 — Gap #16)', () => {
  it('returns NO_MAPPING when no seller mappings exist for the product', async () => {
    const { svc } = buildMocks({
      postOffice: { latitude: 19.0, longitude: 72.8 },
      sellerMappings: [],
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe('NO_MAPPING');
  });

  it('returns OUT_OF_STOCK when mappings exist but stockQty - reservedQty < quantity', async () => {
    const { svc } = buildMocks({
      postOffice: { latitude: 19.0, longitude: 72.8 },
      sellerMappings: [
        activeSellerMapping({ stockQty: 5, reservedQty: 5 }),
      ],
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.reason).toBe('OUT_OF_STOCK');
  });

  it('returns OK + serviceable=true on a successful allocation', async () => {
    const { svc } = buildMocks({
      postOffice: { latitude: 19.0, longitude: 72.8 },
      sellerMappings: [
        activeSellerMapping({
          latitude: 19.1,
          longitude: 72.9, // ~12km away — well within cap
        }),
      ],
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.serviceable).toBe(true);
    expect(result.reason).toBe('OK');
    expect(result.primary).not.toBeNull();
  });
});

// ─── Gap #8: distance cap ─────────────────────────────────────────────

describe('allocate distance cap (Phase 64 — Gap #8)', () => {
  it('filters out a candidate beyond ROUTING_MAX_DISTANCE_KM', async () => {
    const { svc } = buildMocks({
      postOffice: { latitude: 13.08, longitude: 80.27 }, // Chennai
      sellerMappings: [
        activeSellerMapping({
          latitude: 31.63,
          longitude: 74.87, // Amritsar, ~2200km
        }),
      ],
      envMaxDistance: 1500,
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      customerPincode: '600001',
      quantity: 1,
    });
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe('DISTANCE_EXCEEDED');
  });

  it('keeps a candidate inside the cap', async () => {
    const { svc } = buildMocks({
      postOffice: { latitude: 19.0, longitude: 72.8 }, // Mumbai
      sellerMappings: [
        activeSellerMapping({
          latitude: 19.1,
          longitude: 72.9, // ~12km
        }),
      ],
      envMaxDistance: 1500,
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.serviceable).toBe(true);
  });
});

// ─── Gap #9: null distance instead of 999 placeholder ─────────────────

describe('allocate null-distance (Phase 64 — Gap #9)', () => {
  it('marks distanceKm as null when seller has no coordinates', async () => {
    const { svc } = buildMocks({
      postOffice: { latitude: 19.0, longitude: 72.8 },
      sellerMappings: [
        activeSellerMapping({
          latitude: null,
          longitude: null,
          pickupPincode: null,
        }),
      ],
    });
    const result = await svc.allocate({
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.primary).not.toBeNull();
    expect(result.primary!.distanceKm).toBeNull();
  });
});

// ─── Gap #3 + #5: previewServiceability skips AllocationLog write ─────

describe('previewServiceability (Phase 64 — Gaps #3 + #5)', () => {
  it('does NOT call prisma.allocationLog.create', async () => {
    const { svc, prisma } = buildMocks({
      postOffice: { latitude: 19.0, longitude: 72.8 },
      sellerMappings: [activeSellerMapping({ latitude: 19.1, longitude: 72.9 })],
    });
    await svc.previewServiceability({
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(prisma.allocationLog.create).not.toHaveBeenCalled();
  });

  it('still applies the same eligibility rules as allocate (service-area opt-in)', async () => {
    const { svc, prisma } = buildMocks({
      postOffice: { latitude: 19.0, longitude: 72.8 },
      sellerMappings: [
        activeSellerMapping({ latitude: 19.1, longitude: 72.9 }),
      ],
      // Seller has opted-in to service-area; current pincode is NOT in their set.
      serviceAreas: [{ sellerId: SELLER_ID }],
    });
    // Override: opted-in returns SELLER_ID, serving returns empty.
    prisma.sellerServiceArea.findMany
      .mockResolvedValueOnce([{ sellerId: SELLER_ID }]) // opted-in
      .mockResolvedValueOnce([]); // serving this pincode
    const result = await svc.previewServiceability({
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      customerPincode: '400001',
      quantity: 1,
    });
    expect(result.serviceable).toBe(false);
    expect(result.reason).toBe('NO_SERVICE_AREA');
  });
});
