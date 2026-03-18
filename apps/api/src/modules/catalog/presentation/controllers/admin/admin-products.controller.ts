import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AppException } from '../../../../../core/exceptions/app.exception';
import { AdminAuthGuard } from '../../../../../core/guards';
import { ProductSlugService } from '../../../application/services/product-slug.service';
import { AdminCreateProductDto } from '../../dtos/admin-create-product.dto';
import { UpdateProductDto } from '../../dtos/update-product.dto';
import { AdminRejectProductDto } from '../../dtos/admin-reject-product.dto';
import { AdminRequestChangesDto } from '../../dtos/admin-request-changes.dto';
import { AdminUpdateProductStatusDto } from '../../dtos/admin-update-status.dto';

@ApiTags('Admin Products')
@Controller('admin/products')
@UseGuards(AdminAuthGuard)
export class AdminProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly slugService: ProductSlugService,
  ) {
    this.logger.setContext('AdminProductsController');
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('moderationStatus') moderationStatus?: string,
    @Query('categoryId') categoryId?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '10', 10) || 10));

    const where: any = {
      isDeleted: false,
    };

    if (status) where.status = status;
    if (moderationStatus) where.moderationStatus = moderationStatus;
    if (categoryId) where.categoryId = categoryId;
    if (sellerId) where.sellerId = sellerId;

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { baseSku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          seller: {
            select: {
              id: true,
              sellerName: true,
              sellerShopName: true,
              email: true,
            },
          },
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: {
            where: { isDeleted: false },
            select: { stock: true },
          },
          _count: { select: { variants: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.product.count({ where }),
    ]);

    const mapped = products.map((p: any) => {
      const totalVariantStock = p.variants?.reduce((sum: number, v: any) => sum + (v.stock || 0), 0) ?? 0;
      return {
        ...p,
        variantCount: p._count?.variants ?? 0,
        totalStock: p.hasVariants ? totalVariantStock : (p.baseStock ?? 0),
        primaryImageUrl: p.images?.[0]?.url ?? null,
        _count: undefined,
        images: undefined,
        variants: undefined,
      };
    });

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

  @Get(':productId')
  @HttpCode(HttpStatus.OK)
  async getProduct(@Param('productId') productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      include: {
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            email: true,
          },
        },
        variants: {
          where: { isDeleted: false },
          include: {
            optionValues: {
              include: {
                optionValue: {
                  include: {
                    optionDefinition: true,
                  },
                },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        options: {
          include: {
            optionDefinition: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
        optionValues: {
          include: {
            optionValue: true,
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        tags: true,
        seo: true,
        category: true,
        brand: true,
        statusHistory: {
          orderBy: { createdAt: 'desc' },
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Req() req: Request, @Body() dto: AdminCreateProductDto) {
    const adminId = (req as any).adminId;

    // Look up seller by email
    const seller = await this.prisma.seller.findUnique({
      where: { email: dto.sellerEmail },
      select: { id: true, status: true },
    });

    if (!seller) {
      throw new NotFoundAppException(
        `Seller with email ${dto.sellerEmail} not found`,
      );
    }

    if (seller.status !== 'ACTIVE') {
      throw new AppException('Seller account is not active', 'BAD_REQUEST');
    }

    // Find or create category by name
    let categoryId = dto.categoryId;
    if (!categoryId && (dto as any).categoryName) {
      const catName = (dto as any).categoryName.trim();
      let category = await this.prisma.category.findFirst({ where: { name: { equals: catName, mode: 'insensitive' } } });
      if (!category) {
        const catSlug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        category = await this.prisma.category.create({ data: { name: catName, slug: catSlug } });
      }
      categoryId = category.id;
    }

    // Find or create brand by name
    let brandId = dto.brandId;
    if (!brandId && (dto as any).brandName) {
      const brName = (dto as any).brandName.trim();
      let brand = await this.prisma.brand.findFirst({ where: { name: { equals: brName, mode: 'insensitive' } } });
      if (!brand) {
        const brSlug = brName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        brand = await this.prisma.brand.create({ data: { name: brName, slug: brSlug } });
      }
      brandId = brand.id;
    }

    const slug = await this.slugService.generateUniqueSlug(dto.title);

    const product = await this.prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          sellerId: seller.id,
          title: dto.title,
          slug,
          shortDescription: dto.shortDescription,
          description: dto.description,
          categoryId,
          brandId,
          hasVariants: dto.hasVariants,
          basePrice: dto.basePrice,
          baseSku: dto.baseSku,
          baseStock: dto.baseStock,
          weight: dto.weight,
          weightUnit: dto.weightUnit,
          length: dto.length,
          width: dto.width,
          height: dto.height,
          dimensionUnit: dto.dimensionUnit,
          returnPolicy: dto.returnPolicy,
          warrantyInfo: dto.warrantyInfo,
        },
      });

      if (dto.tags && dto.tags.length > 0) {
        await tx.productTag.createMany({
          data: dto.tags.map((tag) => ({
            productId: newProduct.id,
            tag,
          })),
        });
      }

      if (dto.seo) {
        await tx.productSeo.create({
          data: {
            productId: newProduct.id,
            metaTitle: dto.seo.metaTitle,
            metaDescription: dto.seo.metaDescription,
            handle: dto.seo.handle,
          },
        });
      }

      if (dto.variants && dto.variants.length > 0) {
        for (let i = 0; i < dto.variants.length; i++) {
          const v = dto.variants[i];
          const variant = await tx.productVariant.create({
            data: {
              productId: newProduct.id,
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              costPrice: v.costPrice,
              sku: v.sku,
              stock: v.stock ?? 0,
              weight: v.weight,
              sortOrder: i,
            },
          });

          if (v.optionValueIds && v.optionValueIds.length > 0) {
            await tx.productVariantOptionValue.createMany({
              data: v.optionValueIds.map((ovId) => ({
                variantId: variant.id,
                optionValueId: ovId,
              })),
            });
          }
        }
      }

      await tx.productStatusHistory.create({
        data: {
          productId: newProduct.id,
          fromStatus: null,
          toStatus: 'DRAFT',
          changedBy: adminId,
          reason: 'Product created by admin',
        },
      });

      return newProduct;
    });

    this.logger.log(
      `Product created by admin ${adminId}: ${product.id} for seller ${seller.id}`,
    );

    const fullProduct = await this.prisma.product.findUnique({
      where: { id: product.id },
      include: {
        tags: true,
        seo: true,
        variants: true,
        category: true,
        brand: true,
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            email: true,
          },
        },
      },
    });

    return {
      success: true,
      message: 'Product created successfully',
      data: fullProduct,
    };
  }

  @Patch(':productId')
  @HttpCode(HttpStatus.OK)
  async updateProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    const adminId = (req as any).adminId;

    const existing = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });

    if (!existing) {
      throw new NotFoundAppException('Product not found');
    }

    const updateData: any = {};
    if (dto.title !== undefined) {
      updateData.title = dto.title;
      updateData.slug = await this.slugService.generateUniqueSlug(dto.title);
    }
    if (dto.categoryId !== undefined) updateData.categoryId = dto.categoryId;
    if (dto.brandId !== undefined) updateData.brandId = dto.brandId;

    // Find or create category by name
    if ((dto as any).categoryName !== undefined) {
      const catName = (dto as any).categoryName.trim();
      let category = await this.prisma.category.findFirst({ where: { name: { equals: catName, mode: 'insensitive' } } });
      if (!category) {
        const catSlug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        category = await this.prisma.category.create({ data: { name: catName, slug: catSlug } });
      }
      updateData.categoryId = category.id;
    }

    // Find or create brand by name
    if ((dto as any).brandName !== undefined) {
      const brName = (dto as any).brandName.trim();
      let brand = await this.prisma.brand.findFirst({ where: { name: { equals: brName, mode: 'insensitive' } } });
      if (!brand) {
        const brSlug = brName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        brand = await this.prisma.brand.create({ data: { name: brName, slug: brSlug } });
      }
      updateData.brandId = brand.id;
    }

    if (dto.shortDescription !== undefined) updateData.shortDescription = dto.shortDescription;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.hasVariants !== undefined) updateData.hasVariants = dto.hasVariants;
    if (dto.basePrice !== undefined) updateData.basePrice = dto.basePrice;
    if (dto.compareAtPrice !== undefined) updateData.compareAtPrice = dto.compareAtPrice;
    if (dto.costPrice !== undefined) updateData.costPrice = dto.costPrice;
    if (dto.baseSku !== undefined) updateData.baseSku = dto.baseSku;
    if (dto.baseBarcode !== undefined) updateData.baseBarcode = dto.baseBarcode;
    if (dto.baseStock !== undefined) updateData.baseStock = dto.baseStock;
    if (dto.weight !== undefined) updateData.weight = dto.weight;
    if (dto.weightUnit !== undefined) updateData.weightUnit = dto.weightUnit;
    if (dto.length !== undefined) updateData.length = dto.length;
    if (dto.width !== undefined) updateData.width = dto.width;
    if (dto.height !== undefined) updateData.height = dto.height;
    if (dto.dimensionUnit !== undefined) updateData.dimensionUnit = dto.dimensionUnit;
    if (dto.returnPolicy !== undefined) updateData.returnPolicy = dto.returnPolicy;
    if (dto.warrantyInfo !== undefined) updateData.warrantyInfo = dto.warrantyInfo;

    const product = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: productId },
        data: updateData,
      });

      if (dto.tags !== undefined) {
        await tx.productTag.deleteMany({ where: { productId } });
        if (dto.tags.length > 0) {
          await tx.productTag.createMany({
            data: dto.tags.map((tag) => ({
              productId,
              tag,
            })),
          });
        }
      }

      if (dto.seo !== undefined) {
        await tx.productSeo.upsert({
          where: { productId },
          create: {
            productId,
            metaTitle: dto.seo.metaTitle,
            metaDescription: dto.seo.metaDescription,
            handle: dto.seo.handle,
          },
          update: {
            metaTitle: dto.seo.metaTitle,
            metaDescription: dto.seo.metaDescription,
            handle: dto.seo.handle,
          },
        });
      }

      return updated;
    });

    this.logger.log(`Product ${productId} updated by admin ${adminId}`);

    const fullProduct = await this.prisma.product.findUnique({
      where: { id: product.id },
      include: {
        tags: true,
        seo: true,
        variants: { where: { isDeleted: false } },
        category: true,
        brand: true,
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return {
      success: true,
      message: 'Product updated successfully',
      data: fullProduct,
    };
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  async deleteProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
  ) {
    const adminId = (req as any).adminId;

    const existing = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });

    if (!existing) {
      throw new NotFoundAppException('Product not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Soft-delete all variants
      await tx.productVariant.updateMany({
        where: { productId },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      // Soft-delete the product
      await tx.product.update({
        where: { id: productId },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    });

    this.logger.log(`Product ${productId} deleted by admin ${adminId}`);

    return {
      success: true,
      message: 'Product deleted successfully',
      data: null,
    };
  }

  @Patch(':productId/approve')
  @HttpCode(HttpStatus.OK)
  async approveProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
  ) {
    const adminId = (req as any).adminId;

    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    if (product.status !== 'SUBMITTED') {
      throw new AppException(
        'Only SUBMITTED products can be approved',
        'BAD_REQUEST',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: 'ACTIVE',
          moderationStatus: 'APPROVED',
          moderationNote: null,
        },
      });

      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: 'SUBMITTED',
          toStatus: 'APPROVED',
          changedBy: adminId,
          reason: 'Product approved',
        },
      });

      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: 'APPROVED',
          toStatus: 'ACTIVE',
          changedBy: adminId,
          reason: 'Product activated after approval',
        },
      });
    });

    this.logger.log(`Product ${productId} approved by admin ${adminId}`);

    return {
      success: true,
      message: 'Product approved and activated successfully',
      data: null,
    };
  }

  @Patch(':productId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: AdminRejectProductDto,
  ) {
    const adminId = (req as any).adminId;

    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    if (product.status !== 'SUBMITTED') {
      throw new AppException(
        'Only SUBMITTED products can be rejected',
        'BAD_REQUEST',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: 'REJECTED',
          moderationStatus: 'REJECTED',
          moderationNote: dto.reason,
        },
      });

      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: 'SUBMITTED',
          toStatus: 'REJECTED',
          changedBy: adminId,
          reason: dto.reason,
        },
      });
    });

    this.logger.log(`Product ${productId} rejected by admin ${adminId}`);

    return {
      success: true,
      message: 'Product rejected',
      data: null,
    };
  }

  @Patch(':productId/request-changes')
  @HttpCode(HttpStatus.OK)
  async requestChanges(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: AdminRequestChangesDto,
  ) {
    const adminId = (req as any).adminId;

    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    if (product.status !== 'SUBMITTED') {
      throw new AppException(
        'Only SUBMITTED products can have changes requested',
        'BAD_REQUEST',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: 'CHANGES_REQUESTED',
          moderationStatus: 'CHANGES_REQUESTED',
          moderationNote: dto.note,
        },
      });

      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: 'SUBMITTED',
          toStatus: 'CHANGES_REQUESTED',
          changedBy: adminId,
          reason: dto.note,
        },
      });
    });

    this.logger.log(
      `Changes requested for product ${productId} by admin ${adminId}`,
    );

    return {
      success: true,
      message: 'Changes requested',
      data: null,
    };
  }

  @Patch(':productId/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: AdminUpdateProductStatusDto,
  ) {
    const adminId = (req as any).adminId;

    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    // Validate allowed transitions
    const allowedTransitions: Record<string, string[]> = {
      ACTIVE: ['SUSPENDED', 'ARCHIVED'],
      SUSPENDED: ['ACTIVE', 'ARCHIVED'],
      ARCHIVED: ['ACTIVE'],
    };

    const allowed = allowedTransitions[product.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new AppException(
        `Cannot transition from ${product.status} to ${dto.status}`,
        'BAD_REQUEST',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: dto.status as any,
        },
      });

      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: product.status,
          toStatus: dto.status,
          changedBy: adminId,
          reason: dto.reason || `Status changed to ${dto.status}`,
        },
      });
    });

    this.logger.log(
      `Product ${productId} status changed to ${dto.status} by admin ${adminId}`,
    );

    return {
      success: true,
      message: `Product status updated to ${dto.status}`,
      data: null,
    };
  }
}
