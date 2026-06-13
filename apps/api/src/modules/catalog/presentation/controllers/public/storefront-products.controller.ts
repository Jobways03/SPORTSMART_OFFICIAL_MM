import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { StorefrontFilterValidatorService } from '../../../application/services/storefront-filter-validator.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../../core/exceptions';
import { EventBusService } from '../../../../../bootstrap/events/event-bus.service';
import { sanitizeSearchTerm } from '../../../../../core/utils/search-term.util';
import { Request } from 'express';

// Phase 195 (#10) — name_asc/name_desc are real options in the storefront
// sort dropdown; they were missing here, so selecting "Name A–Z" 400'd.
const ALLOWED_SORTS = new Set(['price_asc', 'price_desc', 'newest', 'popular', 'name_asc', 'name_desc']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Phase 193 (#6) — product slugs are lowercase alphanum + hyphen, ≤200 chars.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/i;

// Phase 193 (#15) — back-in-stock capture body. Declared before the
// controller so the @Body() param decorator can reference it (no TDZ).
class NotifyWhenAvailableDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerId?: string;
}
// #7 — only these filter keys may reach the repo / cache key. Built-ins +
// the metafield keys the validator vets; anything else is dropped.
const MAX_FILTER_KEYS = 15;
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';

@ApiTags('Storefront')
@Controller('storefront/products')
// Phase 192 (#3) — public scraping guard. Cache shields the DB; this caps
// the request rate per IP. Tighter on the cheap autocomplete endpoint.
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class StorefrontProductsController {
  private readonly logger = new Logger(StorefrontProductsController.name);

  constructor(
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    private readonly cache: CatalogCacheService,
    private readonly prisma: PrismaService,
    private readonly filterValidator: StorefrontFilterValidatorService,
    private readonly eventBus: EventBusService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List storefront products with aggregated stock' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'brandId', required: false })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['price_asc', 'price_desc', 'newest', 'popular'] })
  @ApiQuery({ name: 'minPrice', required: false })
  @ApiQuery({ name: 'maxPrice', required: false })
  @ApiQuery({ name: 'collectionId', required: false })
  @ApiQuery({ name: 'brand', required: false, description: 'Brand slug — resolved to brandId' })
  @ApiQuery({ name: 'collection', required: false, description: 'Collection slug — resolved to collectionId' })
  @ApiQuery({ name: 'tag', required: false, description: 'Product tag name — filters to products carrying this tag' })
  async listProducts(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('collectionId') collectionId?: string,
    @Query('brand') brandSlug?: string,
    @Query('collection') collectionSlug?: string,
    @Query('sport') sport?: string,
    @Query('tag') tag?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit || '20', 10) || 20));

    // #6 — validate the enum / id / numeric query params at runtime (the
    // Swagger enum is documentation only). Invalid input → 400.
    if (sortBy && !ALLOWED_SORTS.has(sortBy)) {
      throw new BadRequestAppException(`Invalid sortBy "${sortBy}"`);
    }
    if (categoryId && !UUID_RE.test(categoryId)) {
      throw new BadRequestAppException('categoryId must be a UUID');
    }
    if (brandId && !UUID_RE.test(brandId)) {
      throw new BadRequestAppException('brandId must be a UUID');
    }
    if (collectionId && !UUID_RE.test(collectionId)) {
      throw new BadRequestAppException('collectionId must be a UUID');
    }
    for (const [label, val] of [['minPrice', minPrice], ['maxPrice', maxPrice]] as const) {
      if (val !== undefined && val !== '' && (Number.isNaN(Number(val)) || Number(val) < 0)) {
        throw new BadRequestAppException(`${label} must be a non-negative number`);
      }
    }

    // Resolve slug → id for the homepage-style links like
    // /products?brand=puma or /products?collection=ball. An ID passed
    // directly via brandId/collectionId still wins.
    if (!brandId && brandSlug) {
      const brand = await this.prisma.brand.findUnique({
        where: { slug: brandSlug },
        select: { id: true },
      });
      if (brand) brandId = brand.id;
    }
    if (!collectionId && collectionSlug) {
      const col = await this.prisma.productCollection.findUnique({
        where: { slug: collectionSlug },
        select: { id: true },
      });
      if (col) collectionId = col.id;
    }

    // Parse filters from query params.
    //
    // Phase 40 (2026-05-21) — values are NFKC-normalized at the entry
    // boundary so the storefront SERP buckets visual look-alikes (e.g.
    // Cyrillic 'о' vs Latin 'o') into the same product set.
    // Blank values are stripped here so the repo doesn't see empty
    // filter[key]= params.
    const rawQuery = req.query as Record<string, any>;
    const filterObj: Record<string, string> = {};
    if (rawQuery.filter && typeof rawQuery.filter === 'object') {
      Object.assign(filterObj, rawQuery.filter);
    }
    for (const [k, v] of Object.entries(rawQuery)) {
      const m = k.match(/^filter\[(\w+)\]$/);
      if (m && v) filterObj[m[1]!] = String(v);
    }
    for (const key of Object.keys(filterObj)) {
      const normalized = String(filterObj[key])
        .split(',')
        .map((s) => s.trim().normalize('NFKC'))
        .filter(Boolean)
        .join(',');
      if (normalized === '') delete filterObj[key];
      else filterObj[key] = normalized;
    }

    // Phase 40 (2026-05-21) — Gap #10. Validate values against the
    // definition's choices[] before the SQL fires. Invalid values
    // collapse the key out of the filter set.
    const scrubbedFilterObj = await this.filterValidator.scrubFilterObj(filterObj, categoryId);
    Object.keys(filterObj).forEach((k) => delete filterObj[k]);
    Object.assign(filterObj, scrubbedFilterObj);

    // #7 — bound the filter set: drop absurd key names and cap the count so
    // an attacker can't fragment the cache with `filter[<random>]=x` keys.
    for (const k of Object.keys(filterObj)) {
      if (k.length > 40) delete filterObj[k];
    }
    for (const k of Object.keys(filterObj).slice(MAX_FILTER_KEYS)) {
      delete filterObj[k];
    }
    // #8 — deterministic cache key: sort keys so semantically-identical
    // filter sets hash to the same cache entry regardless of arrival order.
    const stableFilters = JSON.stringify(
      Object.fromEntries(Object.entries(filterObj).sort(([a], [b]) => a.localeCompare(b))),
    );

    const sportTrim = sport?.trim() || undefined;
    // Tag filter — normalized + length-capped before it reaches the cache key
    // and the SQL, same hygiene as the other free-text params.
    const tagTrim = tag?.trim().normalize('NFKC').slice(0, 80) || undefined;
    // Phase 195 (#7) — trim/strip-control/cap-length the free-text search
    // before it reaches the cache key OR the ILIKE pattern, so a 2 KB
    // payload can't become a 2 KB scan pattern and look-alike whitespace
    // can't fragment the cache.
    const searchTerm = sanitizeSearchTerm(search) || undefined;
    const result = await this.cache.getOrSetProductList(
      { page: pageNum, limit: limitNum, search: searchTerm, categoryId, brandId, collectionId, sortBy, minPrice, maxPrice, availability: filterObj.availability || null, brandFilter: filterObj.brand || null, filters: stableFilters, sport: sportTrim || null, tag: tagTrim || null },
      async () => {
        const { products, total } = await this.storefrontRepo.findProductsPaginated({
          page: pageNum, limit: limitNum, search: searchTerm, categoryId, brandId, collectionId,
          sortBy, minPrice, maxPrice, sport: sportTrim, tag: tagTrim, filterObj,
        });

        // Enrich the page with two batch queries: distinct COLOR
        // option values per product (for the swatch row) and the
        // approved review aggregate (rating + count). Both are bounded
        // by the page size, so the extra round trips cost ~ms.
        const productIds = products.map((p: any) => p.id);
        const [swatchesByProduct, reviewsByProduct, rangeByProduct] = await Promise.all([
          this.fetchSwatchesByProduct(productIds),
          this.fetchReviewAggregatesByProduct(productIds),
          // #15 — variant price range for multi-variant cards.
          this.fetchVariantPriceRanges(productIds),
        ]);

        const mapped = products.map((p: any) => {
          const swatches = swatchesByProduct.get(p.id) ?? [];
          const reviews = reviewsByProduct.get(p.id);
          const range = rangeByProduct.get(p.id);
          return {
            id: p.id, productCode: p.productCode, title: p.title, slug: p.slug,
            shortDescription: p.shortDescription, categoryName: p.categoryName,
            brandName: p.brandName,
            // #5 — serialize Decimal money as a string (money-on-the-wire
            // discipline); the client coerces to Number only at the format
            // boundary. Customer-facing price is the seller's price.
            price: p.basePrice != null ? String(p.basePrice) : null,
            compareAtPrice: p.compareAtPrice != null ? String(p.compareAtPrice) : null,
            // #15 — { min, max } across the product's variant prices.
            priceRange: range ? { min: range.min, max: range.max } : null,
            primaryImageUrl: p.primaryImageUrl,
            imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
            totalAvailableStock: p.totalAvailableStock, sellerCount: p.sellerCount,
            hasVariants: p.hasVariants, variantCount: p.variantCount,
            // Up to 6 unique color hexes so the card swatch row stays
            // visually balanced; swatchCount is the *total* distinct
            // count (admin may have more than 6 variants of a color
            // option). Empty array when the product has no COLOR
            // option type — the mobile card hides the row entirely.
            swatches: swatches.slice(0, 6),
            swatchCount: swatches.length,
            // Review aggregate. Both null when the product has no
            // approved reviews yet — mobile hides the rating row.
            averageRating: reviews ? reviews.average : null,
            reviewCount: reviews ? reviews.count : 0,
          };
        });

        return {
          products: mapped,
          pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
        };
      },
    );

    // Phase 195 (#15/#23) — emit a search-analytics signal, with a distinct
    // zero-results event, so the product team can see which queries return
    // nothing (and the actor key gives a coarse abuse trail on top of the
    // per-IP @Throttle). Fire-and-forget: a bus hiccup must never fail the
    // storefront read. Only fires when there's an actual query term.
    if (searchTerm) {
      this.eventBus
        .publish({
          eventName: result.pagination.total === 0 ? 'search.zero_results' : 'search.performed',
          aggregate: 'Search',
          aggregateId: searchTerm.slice(0, 64),
          occurredAt: new Date(),
          payload: {
            q: searchTerm,
            total: result.pagination.total,
            page: pageNum,
            categoryId: categoryId ?? null,
            brandId: brandId ?? null,
          },
        })
        .catch((err) => this.logger.warn(`Failed to emit search analytics event: ${err}`));
    }

    return { success: true, message: 'Products retrieved successfully', data: result };
  }

  // ── Batch enrichment helpers ───────────────────────────────────────
  // Both methods are page-bounded — the caller passes the product IDs
  // currently being returned. Empty input returns an empty map.

  /**
   * For each product in the page, the distinct list of color hex values
   * found on its variants. OptionDefinition.type='COLOR' identifies the
   * "color" option; OptionValue.value carries the raw hex (matches the
   * convention used by storefront-filters.controller.ts:452).
   */
  private async fetchSwatchesByProduct(
    productIds: string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (productIds.length === 0) return out;
    try {
      const rows = await this.prisma.productVariantOptionValue.findMany({
        where: {
          variant: { productId: { in: productIds } },
          optionValue: { optionDefinition: { type: 'COLOR' } },
        },
        select: {
          variant: { select: { productId: true } },
          optionValue: { select: { value: true } },
        },
      });
      for (const r of rows) {
        const pid = r.variant.productId;
        const hex = r.optionValue.value;
        if (!hex) continue;
        let arr = out.get(pid);
        if (!arr) {
          arr = [];
          out.set(pid, arr);
        }
        // Dedupe within the product. Same color shared across multiple
        // variants (different sizes of the same colour) only shows once.
        if (!arr.includes(hex)) arr.push(hex);
      }
    } catch (err) {
      // Swatches are a non-essential card embellishment. A failure here
      // must never take down the whole product listing — degrade to
      // "no swatches" and keep serving products.
      this.logger.warn(
        `Swatch enrichment failed; returning empty swatches: ${(err as Error).message}`,
      );
    }
    return out;
  }

  /**
   * Aggregate approved-review count + average rating per product. Reads
   * ProductReview with status=APPROVED so pending / rejected don't
   * leak into the public rating.
   */
  private async fetchReviewAggregatesByProduct(
    productIds: string[],
  ): Promise<Map<string, { average: number; count: number }>> {
    const out = new Map<string, { average: number; count: number }>();
    if (productIds.length === 0) return out;
    try {
      const rows = await this.prisma.productReview.groupBy({
        by: ['productId'],
        where: { productId: { in: productIds }, status: 'APPROVED' },
        _count: { rating: true },
        _avg: { rating: true },
      });
      for (const r of rows) {
        const avg = r._avg.rating ?? 0;
        out.set(r.productId, {
          // Round to one decimal so the wire payload stays compact
          // and the mobile card displays a clean "4.6" rather than
          // "4.5999999...".
          average: Math.round(avg * 10) / 10,
          count: r._count.rating ?? 0,
        });
      }
    } catch (err) {
      // Review aggregates are supplementary. If the product_reviews
      // table is unavailable (e.g. not yet migrated) or the query
      // fails, the listing must still render — degrade to "no rating".
      // This is the guard that prevents the storefront 500 seen when
      // product_reviews is missing on a migrate-provisioned database.
      this.logger.warn(
        `Review aggregate enrichment failed; returning no ratings: ${(err as Error).message}`,
      );
    }
    return out;
  }

  /**
   * Phase 192 (#15) — min/max variant price per product (string money).
   * Only ACTIVE, non-deleted variants count. Page-bounded.
   */
  private async fetchVariantPriceRanges(
    productIds: string[],
  ): Promise<Map<string, { min: string; max: string }>> {
    const out = new Map<string, { min: string; max: string }>();
    if (productIds.length === 0) return out;
    try {
      const rows = await this.prisma.productVariant.groupBy({
        by: ['productId'],
        where: { productId: { in: productIds }, isDeleted: false, status: { in: ['ACTIVE', 'OUT_OF_STOCK'] } },
        _min: { price: true },
        _max: { price: true },
      });
      for (const r of rows) {
        if (r._min.price == null || r._max.price == null) continue;
        out.set(r.productId, { min: String(r._min.price), max: String(r._max.price) });
      }
    } catch (err) {
      this.logger.warn(`Variant price-range enrichment failed: ${(err as Error).message}`);
    }
    return out;
  }

  @Get('search-suggestions')
  @HttpCode(HttpStatus.OK)
  // #3 — autocomplete is cheap to spam + can enumerate titles; tighter cap.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get search suggestions for autocomplete' })
  @ApiQuery({ name: 'q', required: true })
  async searchSuggestions(@Query('q') q?: string) {
    // Phase 195 (#7) — sanitize + length-cap before the DB; <2 chars no-ops.
    const term = sanitizeSearchTerm(q);
    if (term.length < 2) {
      return { success: true, message: 'Search suggestions', data: { suggestions: [] } };
    }

    const results = await this.storefrontRepo.findSearchSuggestions(term);
    return {
      success: true,
      message: 'Search suggestions',
      data: { suggestions: results.map((r) => ({ title: r.title, slug: r.slug })) },
    };
  }

  /**
   * Phase 42 (2026-05-21) — server-side variant resolution.
   *
   * Closes the 100% checklist row 8 gap: the storefront PDP previously
   * matched the selected option combination to a variantId via
   * in-memory JS comparison over the variants array. That fails when
   * the variant's optionValues array is incomplete (some join rows
   * missing) and is non-deterministic if duplicate combinations exist.
   *
   * Now the backend computes the deterministic optionFingerprint
   * (same hash as VariantGeneratorService) and looks the variant up
   * via the partial-unique (productId, optionFingerprint) index from
   * Phase 41. Returns the unique variantId or 404.
   *
   * Declared BEFORE `@Get(':slug')` so /catalog/products/:slug/...
   * subpaths don't collide with the slug param.
   */
  @Get(':slug/resolve-variant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve an option-value combination to a unique variantId' })
  @ApiQuery({ name: 'optionValueIds', required: true, description: 'Comma-separated list of OptionValue UUIDs' })
  async resolveVariant(
    @Param('slug') slug: string,
    @Query('optionValueIds') optionValueIdsCsv?: string,
  ) {
    if (!optionValueIdsCsv) {
      throw new NotFoundAppException('optionValueIds is required');
    }
    const optionValueIds = optionValueIdsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (optionValueIds.length === 0) {
      throw new NotFoundAppException('optionValueIds must contain at least one id');
    }

    const product = await this.prisma.product.findFirst({
      where: { slug, isDeleted: false, status: 'ACTIVE', moderationStatus: 'APPROVED' },
      select: { id: true },
    });
    if (!product) throw new NotFoundAppException('Product not found');

    // Same fingerprint algorithm as VariantGeneratorService.
    // Sorting + sha256 of the joined id list. Imported lazily here so
    // the storefront controller doesn't depend on the application
    // service layer.
    const { createHash } = await import('crypto');
    const fingerprint = createHash('sha256')
      .update([...optionValueIds].sort().join('|'))
      .digest('hex');

    const variant = await this.prisma.productVariant.findFirst({
      where: {
        productId: product.id,
        optionFingerprint: fingerprint,
        isDeleted: false,
        status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
      },
      select: { id: true, masterSku: true, sku: true, title: true, price: true, status: true },
    });

    if (!variant) {
      throw new NotFoundAppException('No variant matches this combination');
    }

    return {
      success: true,
      message: 'Variant resolved',
      data: variant,
    };
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  // #4 — detail pages are browsed more than the listing; allow a higher cap.
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get product detail with aggregated stock (no seller info)' })
  async getProductDetail(@Param('slug') slug: string) {
    // #6 — reject a non-slug param before it hits the DB.
    if (!SLUG_RE.test(slug)) {
      throw new NotFoundAppException('Product not found');
    }
    // #7 — cache the multi-aggregate detail payload (60s TTL; invalidated on
    // product/stock change via CatalogCacheService.invalidateProductDetail).
    const data = await this.cache.getOrSetProductDetail(slug, () => this.buildProductDetail(slug));
    return { success: true, message: 'Product retrieved successfully', data };
  }

  private async buildProductDetail(slug: string): Promise<any> {
    const product = await this.storefrontRepo.findProductDetailBySlug(slug);
    if (!product) throw new NotFoundAppException('Product not found');

    const sellerMappings = await this.storefrontRepo.findSellerMappingsForProduct(product.id);

    // Stock for a no-variant product. Its offer may be recorded at the
    // product level (variantId null) OR against a single "default" variant,
    // so count every approved mapping — matching how the storefront list
    // query aggregates stock. Filtering to variantId-null only made such
    // products show "Out of stock" on the PDP while the list showed stock.
    const productLevelMappings = sellerMappings;
    const totalProductStock = productLevelMappings.reduce((sum: number, m: any) => sum + Math.max(m.stockQty - m.reservedQty, 0), 0);
    const productSellerCount = new Set(productLevelMappings.filter((m: any) => m.stockQty - m.reservedQty > 0).map((m: any) => m.sellerId)).size;

    // Aggregate per-variant stock
    const variantMappings = sellerMappings.filter((m: any) => m.variantId);
    const variantAggMap = new Map<string, { totalStock: number; sellerCount: number }>();
    {
      const tempMap = new Map<string, { totalStock: number; sellers: Set<string> }>();
      for (const m of variantMappings) {
        if (!tempMap.has(m.variantId!)) tempMap.set(m.variantId!, { totalStock: 0, sellers: new Set() });
        const entry = tempMap.get(m.variantId!)!;
        const available = Math.max(m.stockQty - m.reservedQty, 0);
        entry.totalStock += available;
        if (available > 0) entry.sellers.add(m.sellerId);
      }
      for (const [vid, entry] of tempMap.entries()) {
        variantAggMap.set(vid, { totalStock: entry.totalStock, sellerCount: entry.sellers.size });
      }
    }

    // Build product options
    const productOptions = product.options.map((opt: any) => {
      const usedValueIds = new Set(
        product.optionValues
          .filter((pov: any) => pov.optionValue.optionDefinition.id === opt.optionDefinition.id)
          .map((pov: any) => pov.optionValue.id),
      );
      return {
        name: opt.optionDefinition.name,
        displayName: opt.optionDefinition.displayName,
        type: opt.optionDefinition.type,
        values: opt.optionDefinition.values
          .filter((v: any) => usedValueIds.has(v.id))
          .map((v: any) => ({ id: v.id, value: v.value, displayValue: v.displayValue })),
      };
    });

    // Map variants
    const mappedVariants = product.variants.map((v: any) => {
      const agg = variantAggMap.get(v.id) || { totalStock: 0, sellerCount: 0 };
      return {
        id: v.id, masterSku: v.masterSku, title: v.title,
        // #5 — string money on the wire (client coerces at the format edge).
        price: v.price != null ? String(v.price) : null,
        compareAtPrice: v.compareAtPrice != null ? String(v.compareAtPrice) : null,
        totalAvailableStock: agg.totalStock, inStock: agg.totalStock > 0,
        optionValues: v.optionValues.map((ov: any) => ({
          optionName: ov.optionValue.optionDefinition.displayName,
          optionType: ov.optionValue.optionDefinition.type,
          value: ov.optionValue.value, displayValue: ov.optionValue.displayValue,
        })),
        images: v.images.map((img: any) => ({ id: img.id, url: img.url, altText: img.altText })),
      };
    });

    const overallStock = product.hasVariants
      ? mappedVariants.reduce((sum: number, v: any) => sum + v.totalAvailableStock, 0)
      : totalProductStock;
    const overallSellerCount = product.hasVariants
      ? new Set(variantMappings.filter((m: any) => m.stockQty - m.reservedQty > 0).map((m: any) => m.sellerId)).size
      : productSellerCount;

    const response: any = {
      id: product.id, productCode: product.productCode, title: product.title,
      slug: product.slug, shortDescription: product.shortDescription,
      description: product.description, hasVariants: product.hasVariants,
      // #5 — string money on the wire.
      price: product.basePrice != null ? String(product.basePrice) : null,
      compareAtPrice: product.compareAtPrice != null ? String(product.compareAtPrice) : null,
      totalAvailableStock: overallStock, sellerCount: overallSellerCount, inStock: overallStock > 0,
      category: product.category ? { id: product.category.id, name: product.category.name, slug: product.category.slug } : null,
      brand: product.brand ? { id: product.brand.id, name: product.brand.name, slug: product.brand.slug } : null,
      images: product.images.map((img: any) => ({ id: img.id, url: img.url, altText: img.altText, isPrimary: img.isPrimary })),
      // #14 — clickable tag chips: name + a derived slug for tag browsing.
      tags: product.tags.map((t: any) => ({ name: t.tag, slug: slugify(t.tag) })),
      seo: product.seo ? { metaTitle: product.seo.metaTitle, metaDescription: product.seo.metaDescription, handle: product.seo.handle } : null,
      options: productOptions,
    };

    if (product.hasVariants) {
      response.variants = mappedVariants;
      response.variantCount = mappedVariants.length;
    }

    return response;
  }

  /**
   * Phase 193 (#2) — related products for the PDP. Same category (preferred)
   * or same brand, in-stock + approved, excluding the current product.
   */
  @Get(':slug/related')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiOperation({ summary: 'Related products (same category/brand, in stock)' })
  @ApiQuery({ name: 'limit', required: false })
  async getRelatedProducts(@Param('slug') slug: string, @Query('limit') limit?: string) {
    if (!SLUG_RE.test(slug)) throw new NotFoundAppException('Product not found');
    const lim = Math.min(12, Math.max(1, parseInt(limit || '8', 10) || 8));
    const items = await this.cache.getOrSetProductDetail(`related:${slug}:${lim}`, async () => {
      const product = await this.prisma.product.findFirst({
        where: { slug, isDeleted: false, status: 'ACTIVE', moderationStatus: 'APPROVED' },
        select: { id: true, categoryId: true, brandId: true },
      });
      if (!product) return [];
      const rows = await this.storefrontRepo.findRelatedProducts({
        productId: product.id,
        categoryId: product.categoryId,
        brandId: product.brandId,
        limit: lim,
      });
      return rows.map((p: any) => ({
        id: p.id, productCode: p.productCode, title: p.title, slug: p.slug,
        shortDescription: p.shortDescription, categoryName: p.categoryName, brandName: p.brandName,
        // #5 — string money on the wire.
        price: p.basePrice != null ? String(p.basePrice) : null,
        compareAtPrice: p.compareAtPrice != null ? String(p.compareAtPrice) : null,
        primaryImageUrl: p.primaryImageUrl ?? null,
        totalAvailableStock: 0, sellerCount: 0,
      }));
    });
    return { success: true, message: 'Related products', data: { products: items } };
  }

  /**
   * Phase 193 (#15) — register interest when a product is out of stock.
   * Public + idempotent on (product, email); a cron re-checks stock and
   * emails once when it returns. Throttled to deter abuse.
   */
  @Post(':slug/notify-when-available')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Notify me when this product is back in stock' })
  async notifyWhenAvailable(
    @Param('slug') slug: string,
    @Body() body: NotifyWhenAvailableDto,
  ) {
    if (!SLUG_RE.test(slug)) throw new NotFoundAppException('Product not found');
    const product = await this.prisma.product.findFirst({
      where: { slug, isDeleted: false, status: 'ACTIVE', moderationStatus: 'APPROVED' },
      select: { id: true },
    });
    if (!product) throw new NotFoundAppException('Product not found');

    const email = body.email.trim().toLowerCase();
    await this.prisma.backInStockRequest.upsert({
      where: { productId_email: { productId: product.id, email } },
      // Re-asking resets the notify flag so a re-stock notifies again.
      create: { productId: product.id, email, customerId: body.customerId ?? null },
      update: { notifiedAt: null },
    });
    return { success: true, message: "We'll email you when it's back in stock", data: { registered: true } };
  }
}

function slugify(value: string): string {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
