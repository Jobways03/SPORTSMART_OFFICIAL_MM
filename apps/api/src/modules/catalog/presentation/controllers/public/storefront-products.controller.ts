import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { StorefrontFilterValidatorService } from '../../../application/services/storefront-filter-validator.service';
import { NotFoundAppException } from '../../../../../core/exceptions';
import { Request } from 'express';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';

@ApiTags('Storefront')
@Controller('storefront/products')
export class StorefrontProductsController {
  private readonly logger = new Logger(StorefrontProductsController.name);

  constructor(
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    private readonly cache: CatalogCacheService,
    private readonly prisma: PrismaService,
    private readonly filterValidator: StorefrontFilterValidatorService,
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
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit || '20', 10) || 20));

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

    const result = await this.cache.getOrSetProductList(
      { page: pageNum, limit: limitNum, search, categoryId, brandId, collectionId, sortBy, minPrice, maxPrice, availability: filterObj.availability || null, brandFilter: filterObj.brand || null, filters: JSON.stringify(filterObj) },
      async () => {
        const { products, total } = await this.storefrontRepo.findProductsPaginated({
          page: pageNum, limit: limitNum, search, categoryId, brandId, collectionId,
          sortBy, minPrice, maxPrice, filterObj,
        });

        // Enrich the page with two batch queries: distinct COLOR
        // option values per product (for the swatch row) and the
        // approved review aggregate (rating + count). Both are bounded
        // by the page size, so the extra round trips cost ~ms.
        const productIds = products.map((p: any) => p.id);
        const [swatchesByProduct, reviewsByProduct] = await Promise.all([
          this.fetchSwatchesByProduct(productIds),
          this.fetchReviewAggregatesByProduct(productIds),
        ]);

        const mapped = products.map((p: any) => {
          const swatches = swatchesByProduct.get(p.id) ?? [];
          const reviews = reviewsByProduct.get(p.id);
          return {
            id: p.id, productCode: p.productCode, title: p.title, slug: p.slug,
            shortDescription: p.shortDescription, categoryName: p.categoryName,
            brandName: p.brandName,
            // Customer-facing price is the seller's price (basePrice at
            // the product level, variant.price at variant level). The
            // old separate platformPrice column is gone.
            price: p.basePrice ? Number(p.basePrice) : null,
            compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
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

  @Get('search-suggestions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get search suggestions for autocomplete' })
  @ApiQuery({ name: 'q', required: true })
  async searchSuggestions(@Query('q') q?: string) {
    if (!q || q.trim().length < 2) {
      return { success: true, message: 'Search suggestions', data: { suggestions: [] } };
    }

    const results = await this.storefrontRepo.findSearchSuggestions(q);
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
  @ApiOperation({ summary: 'Get product detail with aggregated stock (no seller info)' })
  async getProductDetail(@Param('slug') slug: string) {
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
        // Customer sees the seller's `price` directly — no separate
        // platform markup any more.
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null,
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
      price: product.basePrice ? Number(product.basePrice) : null,
      compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
      totalAvailableStock: overallStock, sellerCount: overallSellerCount, inStock: overallStock > 0,
      category: product.category ? { id: product.category.id, name: product.category.name, slug: product.category.slug } : null,
      brand: product.brand ? { id: product.brand.id, name: product.brand.name, slug: product.brand.slug } : null,
      images: product.images.map((img: any) => ({ id: img.id, url: img.url, altText: img.altText, isPrimary: img.isPrimary })),
      tags: product.tags.map((t: any) => t.tag),
      seo: product.seo ? { metaTitle: product.seo.metaTitle, metaDescription: product.seo.metaDescription, handle: product.seo.handle } : null,
      options: productOptions,
    };

    if (product.hasVariants) {
      response.variants = mappedVariants;
      response.variantCount = mappedVariants.length;
    }

    return { success: true, message: 'Product retrieved successfully', data: response };
  }
}
