import { StorefrontProductsController } from './presentation/controllers/public/storefront-products.controller';
import { PrismaStorefrontRepository } from './infrastructure/repositories/prisma-storefront.repository';

// Phase 193 — Product Detail Page flow audit remediation.

function makeCtrl(over: { product?: any; mappings?: any[]; related?: any[]; found?: any } = {}) {
  const storefrontRepo: any = {
    findProductDetailBySlug: jest.fn().mockResolvedValue(over.product ?? null),
    findSellerMappingsForProduct: jest.fn().mockResolvedValue(over.mappings ?? []),
    findRelatedProducts: jest.fn().mockResolvedValue(over.related ?? []),
  };
  // cache passthrough: run the factory.
  const cache: any = { getOrSetProductDetail: jest.fn().mockImplementation((_k: string, f: any) => f()) };
  const prisma: any = {
    product: { findFirst: jest.fn().mockResolvedValue(over.found ?? null) },
    backInStockRequest: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const filterValidator: any = {};
  // Phase 195 — controller now emits search analytics via EventBusService.
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  return {
    ctrl: new StorefrontProductsController(storefrontRepo, cache, prisma, filterValidator, eventBus),
    storefrontRepo,
    cache,
    prisma,
  };
}

const PRODUCT = {
  id: 'p1', productCode: 'PRD-1', title: 'Bat', slug: 'pro-bat', shortDescription: 's',
  description: 'd', hasVariants: false, basePrice: '999.00', compareAtPrice: null,
  category: { id: 'c1', name: 'Bats', slug: 'bats' }, brand: { id: 'b1', name: 'SS', slug: 'ss' },
  images: [], tags: [{ tag: 'Cricket Gear' }], seo: null, options: [], optionValues: [], variants: [],
};

describe('#6 slug validation', () => {
  it('404s a non-slug param on detail', async () => {
    const { ctrl } = makeCtrl();
    await expect(ctrl.getProductDetail('not a slug!')).rejects.toThrow(/not found/i);
  });
  it('404s a non-slug param on related', async () => {
    const { ctrl } = makeCtrl();
    await expect(ctrl.getRelatedProducts('bad slug!')).rejects.toThrow(/not found/i);
  });
});

describe('#7 cache + #14 tag slugs + #5 string price (detail)', () => {
  it('wraps the build in the detail cache and returns tag {name,slug}', async () => {
    const { ctrl, cache } = makeCtrl({ product: PRODUCT });
    const res = await ctrl.getProductDetail('pro-bat');
    expect(cache.getOrSetProductDetail).toHaveBeenCalledWith('pro-bat', expect.any(Function));
    expect(res.data.tags).toEqual([{ name: 'Cricket Gear', slug: 'cricket-gear' }]);
    expect(res.data.price).toBe('999.00');
    expect(typeof res.data.price).toBe('string');
  });

  it('404s when the product is missing', async () => {
    const { ctrl } = makeCtrl({ product: null });
    await expect(ctrl.getProductDetail('pro-bat')).rejects.toThrow(/not found/i);
  });
});

describe('#2 related products', () => {
  it('returns related cards with string prices', async () => {
    const { ctrl, storefrontRepo } = makeCtrl({
      found: { id: 'p1', categoryId: 'c1', brandId: 'b1' },
      related: [{ id: 'p2', title: 'Ball', slug: 'ball', basePrice: '500', compareAtPrice: null, primaryImageUrl: null }],
    });
    const res = await ctrl.getRelatedProducts('pro-bat', '8');
    expect(storefrontRepo.findRelatedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', categoryId: 'c1', brandId: 'b1', limit: 8 }),
    );
    expect((res.data.products as any[])[0].price).toBe('500');
  });

  it('returns empty when the product is missing', async () => {
    const { ctrl, storefrontRepo } = makeCtrl({ found: null });
    const res = await ctrl.getRelatedProducts('pro-bat');
    expect(res.data.products).toEqual([]);
    expect(storefrontRepo.findRelatedProducts).not.toHaveBeenCalled();
  });
});

describe('#15 notify-when-available', () => {
  it('upserts a back-in-stock request for a known product', async () => {
    const { ctrl, prisma } = makeCtrl({ found: { id: 'p1' } });
    const res = await ctrl.notifyWhenAvailable('pro-bat', { email: 'A@B.com' } as any);
    expect(res.data.registered).toBe(true);
    expect(prisma.backInStockRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productId_email: { productId: 'p1', email: 'a@b.com' } } }),
    );
  });

  it('404s for an unknown product', async () => {
    const { ctrl } = makeCtrl({ found: null });
    await expect(ctrl.notifyWhenAvailable('pro-bat', { email: 'a@b.com' } as any)).rejects.toThrow(/not found/i);
  });
});

describe('#2/#3 related repository query', () => {
  const sqlText = (q: any): string => q?.sql ?? q?.strings?.join(' ') ?? String(q);
  it('filters APPROVED + in-stock + excludes self', async () => {
    let captured = '';
    const prisma: any = {
      $queryRaw: jest.fn((q: any) => {
        captured += sqlText(q);
        return Promise.resolve([]);
      }),
    };
    const repo = new PrismaStorefrontRepository(prisma);
    await repo.findRelatedProducts({ productId: 'p1', categoryId: 'c1', brandId: 'b1', limit: 8 });
    expect(captured).toContain("moderation_status = 'APPROVED'");
    expect(captured).toContain('p.id <>'); // excludes self
    expect(captured).toContain('seller_product_mappings');
  });

  it('returns [] with no category or brand', async () => {
    const prisma: any = { $queryRaw: jest.fn() };
    const repo = new PrismaStorefrontRepository(prisma);
    expect(await repo.findRelatedProducts({ productId: 'p1', limit: 8 })).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
