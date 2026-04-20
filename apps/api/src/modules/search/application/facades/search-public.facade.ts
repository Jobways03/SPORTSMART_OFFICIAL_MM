import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class SearchPublicFacade {
  private readonly logger = new Logger(SearchPublicFacade.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search products using Prisma full-text-like queries.
   * When OpenSearch is configured, this should delegate to the OpenSearch adapter.
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
}
