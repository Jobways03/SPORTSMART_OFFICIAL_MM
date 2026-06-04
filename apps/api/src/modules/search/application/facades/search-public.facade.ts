import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { OpenSearchAdapter } from '../../../../integrations/opensearch/adapters/opensearch.adapter';
import { escapeLikePattern, sanitizeSearchTerm, MIN_SEARCH_TERM_LENGTH } from '../../../../core/utils/search-term.util';

@Injectable()
export class SearchPublicFacade {
  private readonly logger = new Logger(SearchPublicFacade.name);
  // Phase 195 (#13) — single-instance guard so two admins clicking
  // "reindex" don't launch overlapping full-catalog walks. Multi-instance
  // safety would need a Redis fenced lock (surfaced, not built).
  private reindexInProgress = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
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
    // Phase 195 (#7/#9) — sanitize (control/length) + escape LIKE wildcards
    // before they reach Prisma `contains`. Below the 2-char floor we treat
    // it as no query (browse-all) rather than scanning on a single char.
    const sanitized = sanitizeSearchTerm(query);
    const safe = sanitized.length >= MIN_SEARCH_TERM_LENGTH ? escapeLikePattern(sanitized) : '';

    const where: any = {
      status: 'ACTIVE',
      isDeleted: false,
      // Phase 195 (#2 CRITICAL) — never surface pending/rejected products in
      // search; mirrors the catalog listing's visibility predicate.
      moderationStatus: 'APPROVED',
    };

    if (safe) {
      // Phase 195 (#11/#19) — drop the heavy long-text `description` scan;
      // search title + SKU + tags + brand/category name instead (parity with
      // the OpenSearch field set, so flipping the engine doesn't change which
      // products match).
      where.OR = [
        { title: { contains: safe, mode: 'insensitive' } },
        { baseSku: { contains: safe, mode: 'insensitive' } },
        { tags: { some: { tag: { contains: safe, mode: 'insensitive' } } } },
        { brand: { name: { contains: safe, mode: 'insensitive' } } },
        { category: { name: { contains: safe, mode: 'insensitive' } } },
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
        // Phase 195 (#20) — secondary id key makes OFFSET pagination
        // deterministic when createdAt ties (bulk imports share timestamps).
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    // Phase 195 (#15) — analytics signal + distinct zero-results event.
    if (sanitized.length >= MIN_SEARCH_TERM_LENGTH) {
      this.eventBus
        .publish({
          eventName: total === 0 ? 'search.zero_results' : 'search.performed',
          aggregate: 'Search',
          aggregateId: sanitized.slice(0, 64),
          occurredAt: new Date(),
          payload: { q: sanitized, total, page, source: 'search_module' },
        })
        .catch((err) => this.logger.warn(`Failed to emit search analytics: ${(err as Error).message}`));
    }

    return { items, total, page, limit };
  }

  /**
   * Rebuild search index — walks every ACTIVE product in the catalog
   * and re-indexes its document. Idempotent (re-running is safe; the
   * adapter's indexDocument is upsert-style).
   *
   * When OpenSearch isn't configured (`SEARCH_OPENSEARCH_ENABLED=false`),
   * this is a deliberate no-op — the Prisma fallback path is the
   * source of truth for searchProducts, so there's nothing to "rebuild".
   *
   * Returns a summary the admin UI surfaces post-trigger so the
   * operator sees the scope of work.
   */
  async rebuildSearchIndex(): Promise<{
    indexed: number;
    failed: number;
    skipped: number;
  }> {
    if (!this.openSearch || !this.env.getBoolean('SEARCH_OPENSEARCH_ENABLED', false)) {
      this.logger.log(
        'Search index rebuild requested but OpenSearch is disabled — Prisma fallback in use, nothing to rebuild.',
      );
      return { indexed: 0, failed: 0, skipped: 0 };
    }

    // Stream the catalog in pages so we never load the full product
    // set into memory. 500 per page is a good balance between memory
    // pressure and number of round-trips for a typical 50K-product
    // catalog (~100 pages, ~5 minutes end-to-end).
    const pageSize = 500;
    let cursor: string | undefined = undefined;
    let indexed = 0;
    let failed = 0;
    let skipped = 0;

    while (true) {
      const findArgs: any = {
        where: { status: 'ACTIVE', isDeleted: false },
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: {
            select: { url: true },
            orderBy: { sortOrder: 'asc' },
            take: 1,
          },
          tags: { select: { tag: true } },
        },
        orderBy: { id: 'asc' },
        take: pageSize,
      };
      if (cursor) {
        findArgs.cursor = { id: cursor };
        findArgs.skip = 1;
      }
      const batch = await this.prisma.product.findMany(findArgs);
      if (batch.length === 0) break;

      for (const product of batch as any[]) {
        try {
          await this.openSearch.indexProduct({
            id: product.id,
            title: product.title,
            description: product.description,
            slug: product.slug,
            baseSku: product.baseSku,
            basePrice: Number(product.basePrice),
            salePrice: product.compareAtPrice
              ? Number(product.compareAtPrice)
              : null,
            categoryId: product.categoryId,
            categoryName: product.category?.name ?? null,
            brandId: product.brandId,
            brandName: product.brand?.name ?? null,
            status: product.status,
            tags: product.tags.map((t: { tag: string }) => t.tag),
            imageUrl: product.images[0]?.url ?? null,
          });
          indexed += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `Failed to index product ${product.id}: ${(err as Error).message}`,
          );
        }
      }
      cursor = (batch as any[])[batch.length - 1].id;
      if (batch.length < pageSize) break;
    }

    this.logger.log(
      `Search index rebuild complete — indexed=${indexed} failed=${failed} skipped=${skipped}`,
    );
    return { indexed, failed, skipped };
  }

  /**
   * Phase 195 (#13) — non-blocking reindex trigger. The POST endpoint
   * returns immediately (202) while the full-catalog walk runs in the
   * background, and a single-instance guard rejects an overlapping run so
   * two admins clicking the button can't launch two concurrent walks.
   * Returns whether a run was started (false = one was already running, or
   * OpenSearch is disabled so there's nothing to rebuild).
   */
  triggerReindex(): { started: boolean; reason?: string } {
    if (!this.openSearch || !this.env.getBoolean('SEARCH_OPENSEARCH_ENABLED', false)) {
      return { started: false, reason: 'OpenSearch disabled — Prisma fallback is authoritative, nothing to rebuild.' };
    }
    if (this.reindexInProgress) {
      return { started: false, reason: 'A reindex is already in progress.' };
    }
    this.reindexInProgress = true;
    // Detach: the request returns 202 immediately.
    void this.rebuildSearchIndex()
      .catch((err) => this.logger.error(`Background reindex failed: ${(err as Error).message}`))
      .finally(() => {
        this.reindexInProgress = false;
      });
    return { started: true };
  }

  /**
   * Update a single product's search document. Called on product
   * create / update / delete events so the index stays in sync without
   * waiting for the daily rebuild.
   */
  async updateSearchDocument(productId: string): Promise<void> {
    if (!this.openSearch || !this.env.getBoolean('SEARCH_OPENSEARCH_ENABLED', false)) {
      this.logger.debug(
        `Search document update for product ${productId} — OpenSearch disabled, Prisma fallback handles it implicitly`,
      );
      return;
    }
    try {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: {
            select: { url: true },
            orderBy: { sortOrder: 'asc' },
            take: 1,
          },
          tags: { select: { tag: true } },
        },
      });
      if (!product || product.isDeleted || product.status !== 'ACTIVE') {
        // Soft-deleted / inactive products are removed from the index
        // so search results never surface them.
        await this.openSearch.removeProduct(productId);
        return;
      }
      await this.openSearch.indexProduct({
        id: product.id,
        title: product.title,
        description: product.description,
        slug: product.slug,
        baseSku: product.baseSku,
        basePrice: Number(product.basePrice),
        salePrice: product.compareAtPrice
          ? Number(product.compareAtPrice)
          : null,
        categoryId: product.categoryId,
        categoryName: product.category?.name ?? null,
        brandId: product.brandId,
        brandName: product.brand?.name ?? null,
        status: product.status,
        tags: product.tags.map((t: { tag: string }) => t.tag),
        imageUrl: product.images[0]?.url ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to update search index for product ${productId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Remove a product from the search index — fired on soft-delete or
   * status flip to INACTIVE.
   */
  async removeSearchDocument(productId: string): Promise<void> {
    if (!this.openSearch || !this.env.getBoolean('SEARCH_OPENSEARCH_ENABLED', false)) {
      return;
    }
    try {
      await this.openSearch.removeProduct(productId);
    } catch (err) {
      this.logger.warn(
        `Failed to remove product ${productId} from search index: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Typeahead suggestions: returns up to 10 matching product titles +
   * brand names. Cheap LIKE for now; swap to pg_trgm + GIN for perf.
   */
  async suggest(q: string): Promise<Array<{ type: 'product' | 'brand' | 'category'; text: string; slug?: string; id?: string }>> {
    // Phase 195 (#7/#9) — sanitize + escape; below the floor return nothing.
    const term = sanitizeSearchTerm(q);
    if (term.length < MIN_SEARCH_TERM_LENGTH) return [];
    const safe = escapeLikePattern(term);

    const [products, brands, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          status: 'ACTIVE',
          isDeleted: false,
          // Phase 195 (#2) — approved-only, consistent with searchProducts.
          moderationStatus: 'APPROVED',
          title: { contains: safe, mode: 'insensitive' },
        },
        select: { id: true, title: true, slug: true },
        take: 5,
      }),
      this.prisma.brand.findMany({
        // Phase 195 (#4 CRITICAL) — disabled brands must not appear as
        // autocomplete hits (they'd link to a zero-result brand page).
        where: { isActive: true, name: { contains: safe, mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 3,
      }),
      this.prisma.category.findMany({
        // Phase 195 (#4 CRITICAL) — only active categories surface.
        where: { isActive: true, name: { contains: safe, mode: 'insensitive' } },
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
      this.openSearch !== undefined &&
      // Phase 195 (#1) — also require the node to actually be configured.
      // Without this, flag-on + adapter-wired + no OPENSEARCH_NODE returned
      // an EMPTY result set (the client no-ops) instead of cleanly falling
      // back to the proven Prisma path.
      this.openSearch.isReady
    );
  }
}
