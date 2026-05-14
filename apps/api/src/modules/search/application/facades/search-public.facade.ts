import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { OpenSearchAdapter } from '../../../../integrations/opensearch/adapters/opensearch.adapter';

@Injectable()
export class SearchPublicFacade {
  private readonly logger = new Logger(SearchPublicFacade.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    // Sprint 6 Story 5.1 — delegate to OpenSearch when the operational
    // flag is on AND the adapter is configured. Optional so the facade
    // still constructs in test harnesses that don't wire the adapter.
    @Optional() private readonly openSearch?: OpenSearchAdapter,
  ) {}

  /**
   * Search products. Path selection (Sprint 6 Story 5.1):
   *
   *   SEARCH_OPENSEARCH_ENABLED=true  → delegate to OpenSearchAdapter.
   *                                     Adapter has its own fallback to
   *                                     empty results on transport error
   *                                     (so a momentary OS blip can't
   *                                     hang storefront search).
   *   otherwise                       → Prisma full-text fallback.
   *
   * Default is OFF so the proven Prisma path keeps running until ops
   * stands up OpenSearch + runs the backfill (POST /admin/search/reindex).
   */
  async searchProducts(
    query: string,
    filters: Record<string, unknown>,
  ): Promise<{
    items: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (this.useOpenSearch()) {
      try {
        const result = await this.openSearch!.searchProducts({
          query,
          categoryId: filters.categoryId as string | undefined,
          brandId: filters.brandId as string | undefined,
          minPrice: filters.minPrice as number | undefined,
          maxPrice: filters.maxPrice as number | undefined,
          page: Number(filters.page) || 1,
          limit: Number(filters.limit) || 20,
        });
        return {
          items: result.items,
          total: result.total,
          page: Number(filters.page) || 1,
          limit: Number(filters.limit) || 20,
        };
      } catch (err) {
        // Adapter swallows transport errors internally per its
        // contract; landing here means the call shape itself broke.
        // Fall through to Prisma so storefront search never goes
        // dark on an OpenSearch outage.
        this.logger.warn(
          `OpenSearch search failed, falling back to Prisma: ${(err as Error).message}`,
        );
      }
    }
    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 20;
    const categoryId = filters.categoryId as string | undefined;
    const brandId = filters.brandId as string | undefined;
    const minPrice = filters.minPrice ? Number(filters.minPrice) : undefined;
    const maxPrice = filters.maxPrice ? Number(filters.maxPrice) : undefined;

    const where: any = {
      status: 'ACTIVE',
      isDeleted: false,
    };

    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { baseSku: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.basePrice = {};
      if (minPrice !== undefined) where.basePrice.gte = minPrice;
      if (maxPrice !== undefined) where.basePrice.lte = maxPrice;
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          basePrice: true,
          compareAtPrice: true,
          baseSku: true,
          status: true,
          hasVariants: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: {
            select: { id: true, url: true, altText: true, sortOrder: true },
            orderBy: { sortOrder: 'asc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Rebuild search index. When OpenSearch is configured, this would
   * re-index all active products. For now, this is a no-op placeholder.
   */
  async rebuildSearchIndex(): Promise<void> {
    this.logger.log('Search index rebuild requested (Prisma fallback — no-op)');
  }

  /**
   * Update a single product's search document.
   * When OpenSearch is configured, this would update the index entry.
   */
  async updateSearchDocument(productId: string): Promise<void> {
    this.logger.log(`Search document update for product ${productId} (Prisma fallback — no-op)`);
  }

  /**
   * Typeahead suggestions: returns up to 10 matching product titles +
   * brand names. Cheap LIKE for now; swap to pg_trgm + GIN for perf.
   */
  async suggest(q: string): Promise<Array<{ type: 'product' | 'brand' | 'category'; text: string; slug?: string; id?: string }>> {
    const term = q.trim();
    if (term.length < 2) return [];

    const [products, brands, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          status: 'ACTIVE',
          isDeleted: false,
          title: { contains: term, mode: 'insensitive' },
        },
        select: { id: true, title: true, slug: true },
        take: 5,
      }),
      this.prisma.brand.findMany({
        where: { name: { contains: term, mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 3,
      }),
      this.prisma.category.findMany({
        where: { name: { contains: term, mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 2,
      }),
    ]);

    return [
      ...products.map((p) => ({ type: 'product' as const, text: p.title, slug: p.slug, id: p.id })),
      ...brands.map((b) => ({ type: 'brand' as const, text: b.name, id: b.id })),
      ...categories.map((c) => ({ type: 'category' as const, text: c.name, id: c.id })),
    ];
  }

  /**
   * Sprint 6 Story 5.1 — operational flag check. Two conditions: env
   * flag is on AND the adapter is injected (means OpenSearchModule
   * was imported by the consuming app module). Either-or fails
   * closed to the Prisma path.
   */
  private useOpenSearch(): boolean {
    return (
      this.env.getBoolean('SEARCH_OPENSEARCH_ENABLED', false) &&
      this.openSearch !== undefined
    );
  }
}
