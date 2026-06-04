/**
 * Phase 195 (Storefront Search audit) — search-module remediations:
 *   #2  moderation gate on searchProducts + suggest
 *   #4  isActive filter on brand/category suggestions
 *   #9  LIKE wildcard escaping before Prisma `contains`
 *   #11/#19 search OR drops description, adds tags/brand/category
 *   #20 deterministic order (createdAt desc, id asc)
 *   #1  useOpenSearch falls back to Prisma when the node isn't ready
 *   #21 controller clamps limit to [1,60]
 *   #13 reindex is async + single-instance-locked
 */
import { SearchPublicFacade } from './application/facades/search-public.facade';
import { SearchProductsController } from './presentation/controllers/search-products.controller';

function makeFacade(opts: { openSearch?: any; osEnabled?: boolean } = {}) {
  const prisma: any = {
    product: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    brand: { findMany: jest.fn().mockResolvedValue([]) },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    sellerProductMapping: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const env: any = { getBoolean: jest.fn().mockReturnValue(opts.osEnabled ?? false), getOptional: jest.fn() };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const facade = new SearchPublicFacade(prisma, env, eventBus, opts.openSearch);
  return { facade, prisma, env, eventBus };
}

describe('SearchPublicFacade.searchProducts — Phase 195', () => {
  it('#2 filters to APPROVED moderation status', async () => {
    const { facade, prisma } = makeFacade();
    await facade.searchProducts('nike', {});
    expect(prisma.product.findMany.mock.calls[0][0].where.moderationStatus).toBe('APPROVED');
  });

  it('#11/#19 search OR drops description and adds tags/brand/category', async () => {
    const { facade, prisma } = makeFacade();
    await facade.searchProducts('nike', {});
    const or = prisma.product.findMany.mock.calls[0][0].where.OR as any[];
    const keys = or.map((c) => Object.keys(c)[0]);
    expect(keys).toEqual(expect.arrayContaining(['title', 'baseSku', 'tags', 'brand', 'category']));
    expect(keys).not.toContain('description');
  });

  it('#9 escapes LIKE wildcards in the search term', async () => {
    const { facade, prisma } = makeFacade();
    await facade.searchProducts('100%', {});
    const or = prisma.product.findMany.mock.calls[0][0].where.OR as any[];
    expect(or[0].title.contains).toBe('100\\%');
  });

  it('#20 orders by createdAt desc then id asc (deterministic)', async () => {
    const { facade, prisma } = makeFacade();
    await facade.searchProducts('nike', {});
    expect(prisma.product.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });

  it('treats sub-2-char input as browse-all (no OR clause)', async () => {
    const { facade, prisma } = makeFacade();
    await facade.searchProducts('a', {});
    expect(prisma.product.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('#15 emits a zero_results event when nothing matches', async () => {
    const { facade, eventBus } = makeFacade();
    await facade.searchProducts('nike', {});
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'search.zero_results' }),
    );
  });
});

describe('SearchPublicFacade.suggest — Phase 195', () => {
  it('#4 filters brands and categories to isActive=true', async () => {
    const { facade, prisma } = makeFacade();
    await facade.suggest('nik');
    expect(prisma.brand.findMany.mock.calls[0][0].where.isActive).toBe(true);
    expect(prisma.category.findMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  it('#2 filters product suggestions to APPROVED', async () => {
    const { facade, prisma } = makeFacade();
    await facade.suggest('nik');
    expect(prisma.product.findMany.mock.calls[0][0].where.moderationStatus).toBe('APPROVED');
  });

  it('returns [] below the 2-char floor', async () => {
    const { facade, prisma } = makeFacade();
    const out = await facade.suggest('n');
    expect(out).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

describe('SearchPublicFacade OpenSearch gate / reindex — Phase 195', () => {
  it('#1 falls back to Prisma when the adapter is present but not ready', async () => {
    const openSearch = { isReady: false, searchProducts: jest.fn() };
    const { facade, prisma } = makeFacade({ openSearch, osEnabled: true });
    await facade.searchProducts('nike', {});
    expect(openSearch.searchProducts).not.toHaveBeenCalled();
    expect(prisma.product.findMany).toHaveBeenCalled();
  });

  it('#1 uses OpenSearch when enabled AND ready', async () => {
    const openSearch = {
      isReady: true,
      searchProducts: jest.fn().mockResolvedValue({ items: [{ id: 'p1' }], total: 1 }),
    };
    const { facade, prisma } = makeFacade({ openSearch, osEnabled: true });
    const res = await facade.searchProducts('nike', {});
    expect(openSearch.searchProducts).toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(res.total).toBe(1);
  });

  it('#13 triggerReindex no-ops when OpenSearch disabled', () => {
    const { facade } = makeFacade({ osEnabled: false });
    expect(facade.triggerReindex().started).toBe(false);
  });

  it('#13 triggerReindex no-ops when adapter absent even if flag on', () => {
    const { facade } = makeFacade({ osEnabled: true });
    expect(facade.triggerReindex().started).toBe(false);
  });
});

describe('SearchProductsController — Phase 195', () => {
  it('#21 clamps an oversized limit to 60', async () => {
    const facade: any = { searchProducts: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 60 }) };
    const ctrl = new SearchProductsController(facade);
    await ctrl.searchProducts('nike', '1', '10000');
    expect(facade.searchProducts).toHaveBeenCalledWith('nike', expect.objectContaining({ limit: 60 }));
  });

  it('#21 floors a negative limit at 1 and a zero/negative page at 1', async () => {
    const facade: any = { searchProducts: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 1 }) };
    const ctrl = new SearchProductsController(facade);
    await ctrl.searchProducts('nike', '0', '-5');
    expect(facade.searchProducts).toHaveBeenCalledWith('nike', expect.objectContaining({ page: 1, limit: 1 }));
  });
});
