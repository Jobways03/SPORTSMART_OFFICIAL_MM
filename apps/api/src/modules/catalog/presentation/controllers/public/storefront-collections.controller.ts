import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../../core/exceptions';

@ApiTags('Storefront Collections')
@Controller('catalog/collections')
export class StorefrontCollectionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listCollections() {
    const collections = await this.prisma.productCollection.findMany({
      where: { isActive: true },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      message: 'Collections retrieved',
      data: collections.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        productCount: c._count.products,
      })),
    };
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  async getCollection(
    @Param('slug') slug: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const collection = await this.prisma.productCollection.findUnique({
      where: { slug },
    });

    if (!collection || !collection.isActive) {
      throw new NotFoundAppException('Collection not found');
    }

    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit || '20', 10) || 20));

    const where = {
      collectionId: collection.id,
      product: {
        status: 'ACTIVE' as const,
        isDeleted: false,
        moderationStatus: 'APPROVED' as const,
      },
    };

    const [maps, total] = await Promise.all([
      this.prisma.productCollectionMap.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              shortDescription: true,
              basePrice: true,
              compareAtPrice: true,
              images: {
                where: { isPrimary: true },
                select: { url: true, altText: true },
                take: 1,
              },
              variants: {
                where: { isDeleted: false, status: 'ACTIVE' as const, stock: { gt: 0 } },
                select: { price: true, compareAtPrice: true, stock: true },
                orderBy: { price: 'asc' },
                take: 1,
              },
              category: { select: { name: true } },
              brand: { select: { name: true } },
              seller: { select: { sellerShopName: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.productCollectionMap.count({ where }),
    ]);

    const products = maps.map((m) => {
      const p = m.product;
      const v = p.variants[0];
      const price = v ? Number(v.price) : p.basePrice ? Number(p.basePrice) : null;
      const compareAt = v?.compareAtPrice ? Number(v.compareAtPrice) : p.compareAtPrice ? Number(p.compareAtPrice) : null;
      return {
        id: p.id,
        title: p.title,
        slug: p.slug,
        shortDescription: p.shortDescription,
        price,
        compareAtPrice: compareAt,
        imageUrl: p.images[0]?.url || null,
        imageAlt: p.images[0]?.altText || p.title,
        category: p.category?.name || null,
        brand: p.brand?.name || null,
        shopName: p.seller?.sellerShopName || null,
        inStock: v ? v.stock > 0 : true,
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
        },
        products,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }
}
