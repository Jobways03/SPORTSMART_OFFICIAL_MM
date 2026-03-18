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

@ApiTags('Storefront')
@Controller('catalog/products')
export class StorefrontProductsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit || '20', 10) || 20));

    const where: any = {
      isDeleted: false,
      status: 'ACTIVE',
    };

    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { shortDescription: { contains: search, mode: 'insensitive' } },
      ];
    }

    let orderBy: any = { createdAt: 'desc' };
    if (sortBy === 'price_asc') orderBy = { basePrice: 'asc' };
    else if (sortBy === 'price_desc') orderBy = { basePrice: 'desc' };
    else if (sortBy === 'title') orderBy = { title: 'asc' };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          shortDescription: true,
          basePrice: true,
          compareAtPrice: true,
          hasVariants: true,
          baseStock: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true, altText: true } },
          variants: {
            where: { isDeleted: false },
            select: { price: true, stock: true },
            orderBy: { price: 'asc' },
            take: 1,
          },
          seller: { select: { sellerShopName: true } },
        },
        orderBy,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.product.count({ where }),
    ]);

    const mapped = products.map((p: any) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      shortDescription: p.shortDescription,
      price: p.hasVariants ? (p.variants?.[0]?.price ?? p.basePrice) : p.basePrice,
      compareAtPrice: p.compareAtPrice,
      imageUrl: p.images?.[0]?.url ?? null,
      imageAlt: p.images?.[0]?.altText ?? p.title,
      category: p.category?.name ?? null,
      brand: p.brand?.name ?? null,
      shopName: p.seller?.sellerShopName ?? null,
      inStock: p.hasVariants
        ? (p.variants?.some((v: any) => v.stock > 0) ?? false)
        : (p.baseStock ?? 0) > 0,
    }));

    return {
      success: true,
      message: 'Products retrieved successfully',
      data: {
        products: mapped,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  async getProduct(@Param('slug') slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isDeleted: false, status: 'ACTIVE' },
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        tags: true,
        variants: {
          where: { isDeleted: false },
          include: {
            optionValues: {
              include: {
                optionValue: {
                  include: { optionDefinition: true },
                },
              },
            },
            images: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        options: {
          include: { optionDefinition: true },
          orderBy: { sortOrder: 'asc' },
        },
        optionValues: {
          include: { optionValue: true },
        },
        seller: {
          select: { sellerShopName: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    return {
      success: true,
      message: 'Product retrieved successfully',
      data: product,
    };
  }
}
