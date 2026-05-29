import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { RedisService } from '../../../../../bootstrap/cache/redis.service';
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../../domain/repositories/category.repository.interface';
import { BRAND_REPOSITORY, IBrandRepository } from '../../../domain/repositories/brand.repository.interface';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';
// Phase 39 (2026-05-21) — public-read of active category metafield
// definitions for the seller / preview rendering paths.
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../../domain/repositories/metafield.repository.interface';

/**
 * Phase 34 (2026-05-21) — keep this key in sync with the admin
 * controller's invalidation. If you rename, rename both.
 */
const STOREFRONT_TREE_CACHE_KEY = 'storefront:categories:tree';
const STOREFRONT_TREE_CACHE_TTL = 60;

/**
 * Phase 35 (2026-05-21) — public brands list cache. Keyed by search
 * so different filter values get their own cache slot (admin glob
 * `storefront:brands:list:*` clears all). 60s TTL matches categories.
 */
const STOREFRONT_BRANDS_CACHE_PREFIX = 'storefront:brands:list';
const STOREFRONT_BRANDS_CACHE_TTL = 60;

/**
 * Phase 39 (2026-05-21) — public category-metafield definitions cache.
 * Keyed per category id so a popular category (Cricket Bats has 30+
 * required fields) reuses one entry. Admin invalidates the entire
 * prefix on every metafield mutation.
 */
const STOREFRONT_METAFIELDS_CACHE_PREFIX = 'storefront:metafields:list';
const STOREFRONT_METAFIELDS_CACHE_TTL = 60;

@ApiTags('Catalog')
@Controller('catalog')
export class CatalogReferenceController {
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
    @Inject(BRAND_REPOSITORY) private readonly brandRepo: IBrandRepository,
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
    private readonly redis: RedisService,
  ) {}

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  async getCategories() {
    // Phase 34 (2026-05-21) — 60s Redis cache. Every storefront cold
    // load hits this endpoint; pre-Phase-34 each call scanned the
    // entire categories table for the flat tree assembly. The cache
    // collapses N requests/min into 1 DB fetch + N memcached reads.
    // Invalidated immediately by any admin mutation (see
    // AdminCategoriesController.invalidateTreeCache).
    const categories = await this.redis.getOrSet(
      STOREFRONT_TREE_CACHE_KEY,
      STOREFRONT_TREE_CACHE_TTL,
      () => this.categoryRepo.findActiveTree(),
    );
    return { success: true, message: 'Categories retrieved successfully', data: categories };
  }

  @Get('categories/:categoryId/options')
  @HttpCode(HttpStatus.OK)
  async getCategoryOptions(@Param('categoryId') categoryId: string) {
    const templates = await this.categoryRepo.findCategoryOptions(categoryId);
    return { success: true, message: 'Category options retrieved successfully', data: templates };
  }

  @Get('brands')
  @HttpCode(HttpStatus.OK)
  async getBrands(@Query('search') search?: string) {
    // Phase 35 (2026-05-21) — 60s Redis cache. Keyed by search term
    // so popular filters (no-search) reuse one entry, while
    // ?search=Nike etc. get their own. Admin invalidates the entire
    // prefix on every brand mutation.
    const key = `${STOREFRONT_BRANDS_CACHE_PREFIX}:${search ?? ''}`;
    const brands = await this.redis.getOrSet(
      key,
      STOREFRONT_BRANDS_CACHE_TTL,
      () => this.brandRepo.findAllActive(search),
    );
    return { success: true, message: 'Brands retrieved successfully', data: brands };
  }

  @Get('options')
  @HttpCode(HttpStatus.OK)
  async getOptions() {
    const options = await this.storefrontRepo.findAllOptionDefinitions();
    return { success: true, message: 'Options retrieved successfully', data: options };
  }

  /**
   * Phase 39 (2026-05-21) — public-read of the active metafield
   * definitions for a category and its ancestors. Used by the seller
   * product form to render the right field set and by the storefront
   * PDP to render the product-info table. Pre-Phase-39 the seller
   * UI had no way to discover what fields a category required and
   * sellers were submitting incomplete listings that the admin queue
   * then bounced.
   *
   * Output is the merged set walking up the parent chain. Inactive
   * + non-CATEGORY ownerTypes are excluded.
   */
  @Get('categories/:categoryId/metafield-definitions')
  @HttpCode(HttpStatus.OK)
  async getCategoryMetafieldDefinitions(@Param('categoryId') categoryId: string) {
    const key = `${STOREFRONT_METAFIELDS_CACHE_PREFIX}:${categoryId}`;
    const defs = await this.redis.getOrSet(
      key,
      STOREFRONT_METAFIELDS_CACHE_TTL,
      () => this.metafieldRepo.findAvailableDefinitions(categoryId),
    );
    return { success: true, message: 'Category metafield definitions retrieved', data: defs };
  }
}
