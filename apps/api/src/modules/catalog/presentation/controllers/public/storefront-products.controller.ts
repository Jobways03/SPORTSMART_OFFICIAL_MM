import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { NotFoundAppException } from '../../../../../core/exceptions';
import { Prisma } from '@prisma/client';
import { Request } from 'express';

@ApiTags('Storefront')
@Controller('storefront/products')
export class StorefrontProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CatalogCacheService,
  ) {}

  // ─── T1: Product Listing API (aggregated stock) ───────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List storefront products with aggregated stock' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'brandId', required: false })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['price_asc', 'price_desc', 'newest'] })
  @ApiQuery({ name: 'minPrice', required: false })
  @ApiQuery({ name: 'maxPrice', required: false })
  @ApiQuery({ name: 'collectionId', required: false })
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
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit || '20', 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Parse built-in filters from query params
    // Express+qs parses filter[key]=val into { filter: { key: 'val' } }
    // But @Query() params are already consumed, so read from req.query directly
    const rawQuery = req.query as Record<string, any>;
    const filterObj: Record<string, string> = {};
    // Handle both nested { filter: { key: val } } and flat { 'filter[key]': val } formats
    if (rawQuery.filter && typeof rawQuery.filter === 'object') {
      Object.assign(filterObj, rawQuery.filter);
    }
    // Also check for flat format
    for (const [k, v] of Object.entries(rawQuery)) {
      const m = k.match(/^filter\[(\w+)\]$/);
      if (m && v) filterObj[m[1]] = String(v);
    }
    const availabilityFilter = filterObj.availability || null;
    const brandFilter = filterObj.brand || null;

    // Build WHERE conditions
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.is_deleted = false`,
      Prisma.sql`p.status = 'ACTIVE'`,
    ];

    // Availability filter: in_stock, out_of_stock, or default (in_stock only)
    if (availabilityFilter === 'out_of_stock') {
      conditions.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM seller_product_mappings spm
        WHERE spm.product_id = p.id
          AND spm.is_active = true
          AND spm.approval_status = 'APPROVED'
          AND (spm.stock_qty - spm.reserved_qty) > 0
      )`);
    } else if (availabilityFilter === 'in_stock') {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM seller_product_mappings spm
        WHERE spm.product_id = p.id
          AND spm.is_active = true
          AND spm.approval_status = 'APPROVED'
          AND (spm.stock_qty - spm.reserved_qty) > 0
      )`);
    } else {
      // Default: only show in-stock products
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM seller_product_mappings spm
        WHERE spm.product_id = p.id
          AND spm.is_active = true
          AND spm.approval_status = 'APPROVED'
          AND (spm.stock_qty - spm.reserved_qty) > 0
      )`);
    }

    // Brand filter from filter[brand] param
    if (brandFilter) {
      conditions.push(Prisma.sql`p.brand_id = ${brandFilter}`);
    }

    if (categoryId) {
      conditions.push(Prisma.sql`p.category_id = ${categoryId}`);
    }
    if (brandId) {
      conditions.push(Prisma.sql`p.brand_id = ${brandId}`);
    }
    if (collectionId) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM product_collection_maps pcm
        WHERE pcm.product_id = p.id AND pcm.collection_id = ${collectionId}
      )`);
    }

    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(Prisma.sql`(
        p.title ILIKE ${searchPattern}
        OR p.short_description ILIKE ${searchPattern}
        OR p.product_code ILIKE ${searchPattern}
      )`);
    }

    // Price filtering — uses platformPrice with basePrice fallback
    if (minPrice) {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) {
        conditions.push(Prisma.sql`COALESCE(p.platform_price, p.base_price, 0) >= ${min}`);
      }
    }
    if (maxPrice) {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) {
        conditions.push(Prisma.sql`COALESCE(p.platform_price, p.base_price, 0) <= ${max}`);
      }
    }

    // Metafield filters — iterate filter object (NestJS parses filter[key]=val as { filter: { key: 'val' } })
    const BUILT_IN_FILTER_KEYS = new Set(['brand', 'availability', 'price_range']);
    for (const [filterKey, rawValue] of Object.entries(filterObj)) {
      if (BUILT_IN_FILTER_KEYS.has(filterKey)) continue; // handled above
      if (rawValue) {
        const values = String(rawValue).split(',').map((v) => v.trim()).filter(Boolean);
        if (values.length > 0) {
          // OR within a group (any of these values), AND between groups
          conditions.push(Prisma.sql`EXISTS (
            SELECT 1 FROM product_metafields pm
            JOIN metafield_definitions md ON md.id = pm.metafield_definition_id
            WHERE pm.product_id = p.id
              AND md.key = ${filterKey}
              AND (
                pm.value_text IN (${Prisma.join(values)})
                OR pm.value_boolean = ${values[0] === 'true'}
                OR pm.value_json @> ${JSON.stringify(values)}::jsonb
              )
          )`);
        }
      }
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    // ORDER BY
    let orderByClause: Prisma.Sql;
    switch (sortBy) {
      case 'price_asc':
        orderByClause = Prisma.sql`ORDER BY COALESCE(p.platform_price, p.base_price, 0) ASC`;
        break;
      case 'price_desc':
        orderByClause = Prisma.sql`ORDER BY COALESCE(p.platform_price, p.base_price, 0) DESC`;
        break;
      case 'newest':
      default:
        orderByClause = Prisma.sql`ORDER BY p.created_at DESC`;
        break;
    }

    const result = await this.cache.getOrSetProductList(
      { page: pageNum, limit: limitNum, search, categoryId, brandId, collectionId, sortBy, minPrice, maxPrice, availability: availabilityFilter, brandFilter, filters: JSON.stringify(filterObj) },
      async () => {
      // Execute count + data in parallel
      const countQuery = Prisma.sql`
        SELECT COUNT(DISTINCT p.id)::int AS total
        FROM products p
        ${whereClause}
      `;

      const dataQuery = Prisma.sql`
        SELECT
          p.id,
          p.product_code AS "productCode",
          p.title,
          p.slug,
          p.short_description AS "shortDescription",
          c.name AS "categoryName",
          b.name AS "brandName",
          COALESCE(p.platform_price, p.base_price)::numeric AS "platformPrice",
          p.compare_at_price::numeric AS "compareAtPrice",
          p.has_variants AS "hasVariants",
          COALESCE(
            (
              SELECT pi.url FROM product_images pi
              WHERE pi.product_id = p.id
              ORDER BY pi.is_primary DESC, pi.sort_order ASC
              LIMIT 1
            ),
            (
              SELECT pvi.url FROM product_variant_images pvi
              JOIN product_variants pv ON pv.id = pvi.variant_id
              WHERE pv.product_id = p.id AND pv.is_deleted = false
              ORDER BY pvi.sort_order ASC
              LIMIT 1
            )
          ) AS "primaryImageUrl",
          COALESCE(agg.total_available_stock, 0)::int AS "totalAvailableStock",
          COALESCE(agg.seller_count, 0)::int AS "sellerCount",
          COALESCE(vc.variant_count, 0)::int AS "variantCount"
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN LATERAL (
          SELECT
            SUM(GREATEST(spm.stock_qty - spm.reserved_qty, 0))::int AS total_available_stock,
            COUNT(DISTINCT spm.seller_id)::int AS seller_count
          FROM seller_product_mappings spm
          WHERE spm.product_id = p.id
            AND spm.is_active = true
            AND spm.approval_status = 'APPROVED'
            AND (spm.stock_qty - spm.reserved_qty) > 0
        ) agg ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS variant_count
          FROM product_variants pv
          WHERE pv.product_id = p.id
            AND pv.is_deleted = false
        ) vc ON true
        ${whereClause}
        ${orderByClause}
        LIMIT ${limitNum} OFFSET ${offset}
      `;

      const [countResult, products] = await Promise.all([
        this.prisma.$queryRaw<{ total: number }[]>(countQuery),
        this.prisma.$queryRaw<any[]>(dataQuery),
      ]);

      const total = countResult[0]?.total ?? 0;

      const mapped = products.map((p) => ({
        id: p.id,
        productCode: p.productCode,
        title: p.title,
        slug: p.slug,
        shortDescription: p.shortDescription,
        categoryName: p.categoryName,
        brandName: p.brandName,
        platformPrice: p.platformPrice ? Number(p.platformPrice) : null,
        compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
        primaryImageUrl: p.primaryImageUrl,
        totalAvailableStock: p.totalAvailableStock,
        sellerCount: p.sellerCount,
        hasVariants: p.hasVariants,
        variantCount: p.variantCount,
      }));

      return {
        products: mapped,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    });

    return {
      success: true,
      message: 'Products retrieved successfully',
      data: result,
    };
  }

  // ─── T3: Search Suggestions ───────────────────────────────────────────

  @Get('search-suggestions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get search suggestions for autocomplete' })
  @ApiQuery({ name: 'q', required: true })
  async searchSuggestions(@Query('q') q?: string) {
    if (!q || q.trim().length < 2) {
      return {
        success: true,
        message: 'Search suggestions',
        data: { suggestions: [] },
      };
    }

    const searchPattern = `%${q.trim()}%`;

    const results = await this.prisma.$queryRaw<{ title: string; slug: string }[]>(Prisma.sql`
      SELECT DISTINCT p.title, p.slug
      FROM products p
      WHERE p.is_deleted = false
        AND p.status = 'ACTIVE'
        AND (
          p.title ILIKE ${searchPattern}
          OR p.product_code ILIKE ${searchPattern}
        )
        AND EXISTS (
          SELECT 1 FROM seller_product_mappings spm
          WHERE spm.product_id = p.id
            AND spm.is_active = true
            AND spm.approval_status = 'APPROVED'
            AND (spm.stock_qty - spm.reserved_qty) > 0
        )
      ORDER BY p.title ASC
      LIMIT 5
    `);

    return {
      success: true,
      message: 'Search suggestions',
      data: {
        suggestions: results.map((r) => ({
          title: r.title,
          slug: r.slug,
        })),
      },
    };
  }

  // ─── T2: Product Detail API ───────────────────────────────────────────

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get product detail with aggregated stock (no seller info)' })
  async getProductDetail(@Param('slug') slug: string) {
    // 1. Fetch base product (no seller info)
    const product = await this.prisma.product.findFirst({
      where: { slug, isDeleted: false, status: 'ACTIVE' },
      select: {
        id: true,
        productCode: true,
        title: true,
        slug: true,
        shortDescription: true,
        description: true,
        hasVariants: true,
        platformPrice: true,
        basePrice: true,
        compareAtPrice: true,
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true } },
        images: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            url: true,
            altText: true,
            sortOrder: true,
            isPrimary: true,
          },
        },
        tags: {
          select: { tag: true },
        },
        seo: {
          select: {
            metaTitle: true,
            metaDescription: true,
            handle: true,
          },
        },
        options: {
          include: {
            optionDefinition: {
              include: {
                values: {
                  orderBy: { sortOrder: 'asc' },
                  select: {
                    id: true,
                    value: true,
                    displayValue: true,
                    sortOrder: true,
                  },
                },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        optionValues: {
          select: {
            optionValue: {
              select: {
                id: true,
                value: true,
                displayValue: true,
                optionDefinition: {
                  select: { id: true, name: true, displayName: true, type: true },
                },
              },
            },
          },
        },
        variants: {
          where: { isDeleted: false },
          select: {
            id: true,
            masterSku: true,
            title: true,
            price: true,
            platformPrice: true,
            compareAtPrice: true,
            sortOrder: true,
            status: true,
            optionValues: {
              select: {
                optionValue: {
                  select: {
                    id: true,
                    value: true,
                    displayValue: true,
                    optionDefinition: {
                      select: { id: true, name: true, displayName: true, type: true },
                    },
                  },
                },
              },
            },
            images: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                url: true,
                altText: true,
                sortOrder: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    // 2. Aggregate stock across all approved active seller mappings (product-level + per-variant)
    const sellerMappings = await this.prisma.sellerProductMapping.findMany({
      where: {
        productId: product.id,
        isActive: true,
        approvalStatus: 'APPROVED',
      },
      select: {
        variantId: true,
        stockQty: true,
        reservedQty: true,
        sellerId: true,
      },
    });

    // Aggregate product-level stock (mappings with no variantId)
    const productLevelMappings = sellerMappings.filter((m) => !m.variantId);
    const totalProductStock = productLevelMappings.reduce(
      (sum, m) => sum + Math.max(m.stockQty - m.reservedQty, 0),
      0,
    );
    const productSellerCount = new Set(
      productLevelMappings
        .filter((m) => m.stockQty - m.reservedQty > 0)
        .map((m) => m.sellerId),
    ).size;

    // Aggregate per-variant stock
    const variantMappings = sellerMappings.filter((m) => m.variantId);

    // Build variant aggregation
    const variantAggMap = new Map<string, { totalStock: number; sellerCount: number }>();
    {
      const tempMap = new Map<string, { totalStock: number; sellers: Set<string> }>();
      for (const m of variantMappings) {
        if (!tempMap.has(m.variantId!)) {
          tempMap.set(m.variantId!, { totalStock: 0, sellers: new Set() });
        }
        const entry = tempMap.get(m.variantId!)!;
        const available = Math.max(m.stockQty - m.reservedQty, 0);
        entry.totalStock += available;
        if (available > 0) {
          entry.sellers.add(m.sellerId);
        }
      }
      for (const [vid, entry] of tempMap.entries()) {
        variantAggMap.set(vid, { totalStock: entry.totalStock, sellerCount: entry.sellers.size });
      }
    }

    // 3. Build product options with available values (only values used by this product)
    const productOptions = product.options.map((opt) => {
      // Filter option values to only those used by this product
      const usedValueIds = new Set(
        product.optionValues
          .filter(
            (pov) =>
              pov.optionValue.optionDefinition.id === opt.optionDefinition.id,
          )
          .map((pov) => pov.optionValue.id),
      );

      return {
        name: opt.optionDefinition.name,
        displayName: opt.optionDefinition.displayName,
        type: opt.optionDefinition.type,
        values: opt.optionDefinition.values
          .filter((v) => usedValueIds.has(v.id))
          .map((v) => ({
            id: v.id,
            value: v.value,
            displayValue: v.displayValue,
          })),
      };
    });

    // 4. Map variants with aggregated stock (no seller info)
    const mappedVariants = product.variants.map((v) => {
      const agg = variantAggMap.get(v.id) || { totalStock: 0, sellerCount: 0 };
      return {
        id: v.id,
        masterSku: v.masterSku,
        title: v.title,
        platformPrice: v.platformPrice ? Number(v.platformPrice) : Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null,
        totalAvailableStock: agg.totalStock,
        inStock: agg.totalStock > 0,
        optionValues: v.optionValues.map((ov) => ({
          optionName: ov.optionValue.optionDefinition.displayName,
          optionType: ov.optionValue.optionDefinition.type,
          value: ov.optionValue.value,
          displayValue: ov.optionValue.displayValue,
        })),
        images: v.images.map((img) => ({
          id: img.id,
          url: img.url,
          altText: img.altText,
        })),
      };
    });

    // Compute overall stock: for variant products, sum variant stock; for simple, use product-level
    const overallStock = product.hasVariants
      ? mappedVariants.reduce((sum, v) => sum + v.totalAvailableStock, 0)
      : totalProductStock;

    const overallSellerCount = product.hasVariants
      ? new Set(
          variantMappings
            .filter((m) => m.stockQty - m.reservedQty > 0)
            .map((m) => m.sellerId),
        ).size
      : productSellerCount;

    // 5. Build response (no seller info exposed)
    const response: any = {
      id: product.id,
      productCode: product.productCode,
      title: product.title,
      slug: product.slug,
      shortDescription: product.shortDescription,
      description: product.description,
      hasVariants: product.hasVariants,
      platformPrice: product.platformPrice
        ? Number(product.platformPrice)
        : product.basePrice
          ? Number(product.basePrice)
          : null,
      compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
      totalAvailableStock: overallStock,
      sellerCount: overallSellerCount,
      inStock: overallStock > 0,
      category: product.category
        ? { id: product.category.id, name: product.category.name, slug: product.category.slug }
        : null,
      brand: product.brand
        ? { id: product.brand.id, name: product.brand.name, slug: product.brand.slug }
        : null,
      images: product.images.map((img) => ({
        id: img.id,
        url: img.url,
        altText: img.altText,
        isPrimary: img.isPrimary,
      })),
      tags: product.tags.map((t) => t.tag),
      seo: product.seo
        ? {
            metaTitle: product.seo.metaTitle,
            metaDescription: product.seo.metaDescription,
            handle: product.seo.handle,
          }
        : null,
      options: productOptions,
    };

    if (product.hasVariants) {
      response.variants = mappedVariants;
      response.variantCount = mappedVariants.length;
    }

    return {
      success: true,
      message: 'Product retrieved successfully',
      data: response,
    };
  }
}
