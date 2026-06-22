import { Public } from '@core/decorators';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SearchPublicFacade } from '../../application/facades/search-public.facade';

/**
 * Search controller — delegates to SearchPublicFacade (no direct Prisma).
 */
@ApiTags('Search')
@Public()
@Controller('search')
// Phase 195 (#5) — public search is an ILIKE fan-out; rate-limit per IP to
// deter scraping / enumeration DoS.
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class SearchProductsController {
  constructor(private readonly searchFacade: SearchPublicFacade) {}

  @Get('products')
  async searchProducts(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    // Phase 195 (#21) — clamp page/limit (was unbounded parseInt, so
    // ?limit=10000 could pull the whole table). Mirrors the storefront
    // controller's [1,60] cap.
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit || '20', 10) || 20));
    const result = await this.searchFacade.searchProducts(q || '', {
      page: pageNum,
      limit: limitNum,
      categoryId,
      brandId,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
    });

    return {
      success: true,
      message: 'Products retrieved',
      data: {
        products: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
        },
      },
    };
  }
}
