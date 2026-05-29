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
import { NotFoundAppException } from '../../../../../core/exceptions';
import { RedisService } from '../../../../../bootstrap/cache/redis.service';
import { COLLECTION_REPOSITORY, ICollectionRepository } from '../../../domain/repositories/collection.repository.interface';

/**
 * Phase 37 (2026-05-21) — keep these keys in sync with the admin
 * controller's invalidation pattern. If renamed, rename both.
 */
const STOREFRONT_COLLECTIONS_CACHE_PREFIX = 'storefront:collections:list';
const STOREFRONT_COLLECTIONS_CACHE_TTL = 60;

@ApiTags('Storefront Collections')
@Controller('catalog/collections')
export class StorefrontCollectionsController {
  constructor(
    @Inject(COLLECTION_REPOSITORY) private readonly collectionRepo: ICollectionRepository,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listCollections(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // Phase 37 (2026-05-21) — paginated + cached. Pre-Phase-37 this
    // returned the entire active list unbounded — fine at 15
    // collections, painful at 200+. 60s Redis cache invalidated by
    // every admin mutation.
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit || '24', 10) || 24));
    const cacheKey = `${STOREFRONT_COLLECTIONS_CACHE_PREFIX}:${pageNum}:${limitNum}`;
    const cached = await this.redis.getOrSet(
      cacheKey,
      STOREFRONT_COLLECTIONS_CACHE_TTL,
      async () => {
        const { collections, total } = await this.collectionRepo.findAllActivePaginated(
          pageNum,
          limitNum,
        );
        return {
          collections: collections.map((c: any) => ({
            id: c.id, name: c.name, slug: c.slug, description: c.description,
            imageUrl: c.imageUrl, imageAltText: c.imageAltText,
            productCount: c._count.products,
          })),
          total,
        };
      },
    );
    return {
      success: true,
      message: 'Collections retrieved',
      data: {
        collections: cached.collections,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: cached.total,
          totalPages: Math.ceil(cached.total / limitNum),
        },
      },
    };
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  async getCollection(@Param('slug') slug: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit || '20', 10) || 20));

    const result = await this.collectionRepo.findBySlugWithProducts(slug, pageNum, limitNum);
    if (!result) throw new NotFoundAppException('Collection not found');

    const { collection, maps, total } = result;

    const products = maps.map((m: any) => {
      const p = m.product;
      const v = p.variants[0];
      const price = v ? Number(v.price) : p.basePrice ? Number(p.basePrice) : null;
      const compareAt = v?.compareAtPrice ? Number(v.compareAtPrice) : p.compareAtPrice ? Number(p.compareAtPrice) : null;
      return {
        id: p.id, title: p.title, slug: p.slug, shortDescription: p.shortDescription,
        price, compareAtPrice: compareAt,
        imageUrl: p.images[0]?.url || null, imageAlt: p.images[0]?.altText || p.title,
        category: p.category?.name || null, brand: p.brand?.name || null,
        shopName: p.seller?.sellerShopName || null, inStock: v ? v.stock > 0 : true,
      };
    });

    return {
      success: true,
      message: 'Collection retrieved',
      data: {
        collection: {
          id: collection.id,
          name: collection.name,
          slug: collection.slug,
          description: collection.description,
          imageUrl: collection.imageUrl,
          imageAltText: collection.imageAltText,
        },
        products,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      },
    };
  }
}
