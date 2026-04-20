import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SearchPublicFacade } from '../../application/facades/search-public.facade';

/**
 * Search controller — delegates to SearchPublicFacade (no direct Prisma).
 */
@ApiTags('Search')
@Controller('search')
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
    const result = await this.searchFacade.searchProducts(q || '', {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
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
