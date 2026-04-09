import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { NotFoundAppException } from '../../../../../core/exceptions';
import { Request } from 'express';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';

@ApiTags('Storefront')
@Controller('storefront/products')
export class StorefrontProductsController {
  constructor(
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    private readonly cache: CatalogCacheService,
  ) {}

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

    // Parse filters from query params
    const rawQuery = req.query as Record<string, any>;
    const filterObj: Record<string, string> = {};
    if (rawQuery.filter && typeof rawQuery.filter === 'object') {
      Object.assign(filterObj, rawQuery.filter);
    }
    for (const [k, v] of Object.entries(rawQuery)) {
      const m = k.match(/^filter\[(\w+)\]$/);
      if (m && v) filterObj[m[1]] = String(v);
    }

    const result = await this.cache.getOrSetProductList(
      { page: pageNum, limit: limitNum, search, categoryId, brandId, collectionId, sortBy, minPrice, maxPrice, availability: filterObj.availability || null, brandFilter: filterObj.brand || null, filters: JSON.stringify(filterObj) },
      async () => {
        const { products, total } = await this.storefrontRepo.findProductsPaginated({
          page: pageNum, limit: limitNum, search, categoryId, brandId, collectionId,
          sortBy, minPrice, maxPrice, filterObj,
        });

        const mapped = products.map((p: any) => ({
          id: p.id, productCode: p.productCode, title: p.title, slug: p.slug,
          shortDescription: p.shortDescription, categoryName: p.categoryName,
          brandName: p.brandName,
          platformPrice: p.platformPrice ? Number(p.platformPrice) : null,
          compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
          primaryImageUrl: p.primaryImageUrl,
          totalAvailableStock: p.totalAvailableStock, sellerCount: p.sellerCount,
          hasVariants: p.hasVariants, variantCount: p.variantCount,
        }));

        return {
          products: mapped,
          pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
        };
      },
    );

    return { success: true, message: 'Products retrieved successfully', data: result };
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

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get product detail with aggregated stock (no seller info)' })
  async getProductDetail(@Param('slug') slug: string) {
    const product = await this.storefrontRepo.findProductDetailBySlug(slug);
    if (!product) throw new NotFoundAppException('Product not found');

    const sellerMappings = await this.storefrontRepo.findSellerMappingsForProduct(product.id);

    // Aggregate product-level stock
    const productLevelMappings = sellerMappings.filter((m: any) => !m.variantId);
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
        platformPrice: v.platformPrice ? Number(v.platformPrice) : Number(v.price),
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
      platformPrice: product.platformPrice ? Number(product.platformPrice) : product.basePrice ? Number(product.basePrice) : null,
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
