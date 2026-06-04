import { StorefrontProductsController } from './presentation/controllers/public/storefront-products.controller';
import { PrismaStorefrontRepository } from './infrastructure/repositories/prisma-storefront.repository';

// Phase 192 — Public Catalog Browsing flow audit remediation.

function makeCtrl() {
  const storefrontRepo: any = { findProductsPaginated: jest.fn().mockResolvedValue({ products: [], total: 0 }) };
  const cache: any = { getOrSetProductList: jest.fn().mockImplementation((_k: any, factory: any) => factory()) };
  const prisma: any = {
    brand: { findUnique: jest.fn().mockResolvedValue(null) },
    productCollection: { findUnique: jest.fn().mockResolvedValue(null) },
    productVariantOptionValue: { findMany: jest.fn().mockResolvedValue([]) },
    productReview: { groupBy: jest.fn().mockResolvedValue([]) },
    productVariant: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  // Real scrubFilterObj returns a NEW object (never mutates input); mirror that.
  const filterValidator: any = { scrubFilterObj: jest.fn().mockImplementation((f: any) => Promise.resolve({ ...f })) };
  // Phase 195 — controller now emits search analytics via EventBusService.
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  return {
    ctrl: new StorefrontProductsController(storefrontRepo, cache, prisma, filterValidator, eventBus),
    storefrontRepo,
    cache,
  };
}
const REQ = (query: Record<string, any> = {}) => ({ query }) as any;

describe('#6 query-param validation', () => {
  it('rejects an invalid sortBy', async () => {
    const { ctrl } = makeCtrl();
    await expect(ctrl.listProducts(REQ(), '1', '20', undefined, undefined, undefined, 'cheapest')).rejects.toThrow(/Invalid sortBy/);
  });
  it('rejects a non-UUID categoryId', async () => {
    const { ctrl } = makeCtrl();
    await expect(ctrl.listProducts(REQ(), '1', '20', undefined, 'not-a-uuid')).rejects.toThrow(/categoryId must be a UUID/);
  });
  it('rejects a negative minPrice', async () => {
    const { ctrl } = makeCtrl();
    await expect(
      ctrl.listProducts(REQ(), '1', '20', undefined, undefined, undefined, undefined, '-5'),
    ).rejects.toThrow(/minPrice/);
  });
  it('accepts valid params', async () => {
    const { ctrl, storefrontRepo } = makeCtrl();
    await ctrl.listProducts(REQ(), '1', '20', 'shoes', undefined, undefined, 'price_asc');
    expect(storefrontRepo.findProductsPaginated).toHaveBeenCalled();
  });
});

describe('#5 string money + #15 variant range + #4 sport', () => {
  function withProduct(p: any, variantRange?: any) {
    const { ctrl, storefrontRepo, cache } = makeCtrl();
    storefrontRepo.findProductsPaginated.mockResolvedValue({ products: [p], total: 1 });
    if (variantRange) {
      (ctrl as any).prisma = (ctrl as any).prisma;
    }
    return { ctrl, storefrontRepo, cache };
  }

  it('serializes basePrice as a string', async () => {
    const { ctrl } = withProduct({ id: 'p1', basePrice: '12345.67', compareAtPrice: '15000.00', hasVariants: false });
    const res = await ctrl.listProducts(REQ());
    const p0 = (res.data as any).products[0];
    expect(p0.price).toBe('12345.67');
    expect(typeof p0.price).toBe('string');
    expect(p0.compareAtPrice).toBe('15000.00');
  });

  it('passes the sport filter through to the repo', async () => {
    const { ctrl, storefrontRepo } = makeCtrl();
    await ctrl.listProducts(REQ(), '1', '20', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'cricket');
    expect(storefrontRepo.findProductsPaginated.mock.calls[0][0].sport).toBe('cricket');
  });
});

describe('#7/#8 filter bounding + stable cache key', () => {
  it('drops over-long filter keys and sorts the cache key', async () => {
    const { ctrl, cache } = makeCtrl();
    const longKey = 'x'.repeat(50);
    await ctrl.listProducts(REQ({ filter: { color: 'red', size: 'L', [longKey]: 'y' } }));
    const cacheKeyArg = cache.getOrSetProductList.mock.calls[0][0];
    const filters = JSON.parse(cacheKeyArg.filters);
    expect(filters[longKey]).toBeUndefined(); // over-long key dropped
    // keys are sorted (color before size).
    expect(Object.keys(filters)).toEqual(['color', 'size']);
  });
});

describe('#2 repository enforces moderationStatus=APPROVED', () => {
  // The repo builds Prisma.Sql objects and passes them to $queryRaw(sql);
  // capture the rendered SQL text (.sql) to assert the predicate is present.
  const sqlText = (q: any): string => q?.sql ?? q?.strings?.join(' ') ?? String(q);

  it('every public listing query filters moderation_status', async () => {
    let captured = '';
    const prisma: any = {
      $queryRaw: jest.fn((q: any) => {
        captured += sqlText(q);
        return Promise.resolve([{ total: 0 }]);
      }),
    };
    const repo = new PrismaStorefrontRepository(prisma);
    await repo.findProductsPaginated({ page: 1, limit: 20, filterObj: {} });
    expect(captured).toContain("moderation_status = 'APPROVED'");
  });

  it('search-suggestions filters moderation_status', async () => {
    let captured = '';
    const prisma: any = {
      $queryRaw: jest.fn((q: any) => {
        captured += sqlText(q);
        return Promise.resolve([]);
      }),
    };
    const repo = new PrismaStorefrontRepository(prisma);
    await repo.findSearchSuggestions('bat');
    expect(captured).toContain("moderation_status = 'APPROVED'");
  });
});
