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
import { EventBusService } from '../../../../../bootstrap/events/event-bus.service';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AppException } from '../../../../../core/exceptions/app.exception';
import { AdminAuthGuard } from '../../../../../core/guards';
import { ProductSlugService } from '../../../application/services/product-slug.service';
import { ProductCodeService } from '../../../application/services/product-code.service';
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
    private readonly productCodeService: ProductCodeService,
    private readonly eventBus: EventBusService,
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
    @Query('hasSellers') hasSellers?: string,
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

    // Only show products that have seller involvement (created by seller OR has seller mappings)
    if (hasSellers === 'true') {
      where.OR = [
        ...(where.OR || []),
        { sellerId: { not: null } },
        { sellerMappings: { some: {} } },
      ];
    }

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
          sellerMappings: {
            where: { approvalStatus: 'APPROVED', isActive: true },
            select: { stockQty: true, reservedQty: true },
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
      // Aggregate stock from approved seller mappings
      const sellerStock = p.sellerMappings?.reduce((sum: number, m: any) => sum + Math.max(0, (m.stockQty || 0) - (m.reservedQty || 0)), 0) ?? 0;
      return {
        ...p,
        variantCount: p._count?.variants ?? 0,
        totalStock: sellerStock,
        primaryImageUrl: p.images?.[0]?.url ?? null,
        _count: undefined,
        images: undefined,
        variants: undefined,
        sellerMappings: undefined,
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
            images: {
              orderBy: { sortOrder: 'asc' },
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

    // Look up seller by email (optional — platform products don't need a seller)
    let seller: { id: string; status: string } | null = null;
    if (dto.sellerEmail) {
      seller = await this.prisma.seller.findUnique({
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
    const productCode = await this.productCodeService.generateProductCode();

    const product = await this.prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          sellerId: seller?.id || null,
          productCode,
          title: dto.title,
          slug,
          shortDescription: dto.shortDescription,
          description: dto.description,
          categoryId,
          brandId,
          hasVariants: dto.hasVariants,
          moderationStatus: 'APPROVED',
          platformPrice: dto.platformPrice,
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
      `Product created by admin ${adminId}: ${product.id}${seller ? ` for seller ${seller.id}` : ' (platform product)'}`,
    );

    // ── Phase 11 / T3: Auto-create SellerProductMapping for the assigned seller ──
    if (seller) {
    try {
      const sellerProfile = await this.prisma.seller.findUnique({
        where: { id: seller.id },
        select: {
          storeAddress: true,
          sellerZipCode: true,
        },
      });

      if (product.hasVariants) {
        const createdVariants = await this.prisma.productVariant.findMany({
          where: { productId: product.id, isDeleted: false },
          select: { id: true, price: true, stock: true },
        });

        for (const variant of createdVariants) {
          await this.prisma.sellerProductMapping.create({
            data: {
              sellerId: seller.id,
              productId: product.id,
              variantId: variant.id,
              stockQty: variant.stock ?? 0,
              settlementPrice: variant.price
                ? Number(variant.price)
                : product.basePrice
                  ? Number(product.basePrice)
                  : undefined,
              pickupAddress: sellerProfile?.storeAddress || null,
              pickupPincode: sellerProfile?.sellerZipCode || null,
              dispatchSla: 2,
              isActive: true,
            },
          });
        }
        if (createdVariants.length > 0) {
          this.logger.log(
            `Auto-created ${createdVariants.length} seller mapping(s) for admin-created variant product ${product.id}`,
          );
        }
      } else {
        await this.prisma.sellerProductMapping.create({
          data: {
            sellerId: seller.id,
            productId: product.id,
            variantId: null,
            stockQty: product.baseStock ?? 0,
            settlementPrice: product.basePrice
              ? Number(product.basePrice)
              : undefined,
            pickupAddress: sellerProfile?.storeAddress || null,
            pickupPincode: sellerProfile?.sellerZipCode || null,
            dispatchSla: 2,
            isActive: true,
          },
        });
        this.logger.log(
          `Auto-created seller mapping for admin-created simple product ${product.id}`,
        );
      }
    } catch (mappingError) {
      this.logger.warn(
        `Failed to auto-create seller mapping for admin product ${product.id}: ${mappingError}`,
      );
    }
    } // end if (seller)

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
        sellerMappings: true,
      },
    });

    return {
      success: true,
      message: 'Product created successfully. Seller has been automatically mapped.',
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
    if (dto.platformPrice !== undefined) updateData.platformPrice = dto.platformPrice;
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

    // Emit event for email notifications
    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.approved',
        aggregate: 'Product',
        aggregateId: productId,
        occurredAt: new Date(),
        payload: {
          productId,
          productTitle: product.title,
          sellerId: product.sellerId,
          adminId,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.approved event: ${err}`);
    }

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

    // Emit event for email notifications
    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.rejected',
        aggregate: 'Product',
        aggregateId: productId,
        occurredAt: new Date(),
        payload: {
          productId,
          productTitle: product.title,
          sellerId: product.sellerId,
          reason: dto.reason,
          adminId,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.rejected event: ${err}`);
    }

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
      DRAFT: ['ACTIVE', 'ARCHIVED'],
      SUBMITTED: ['ACTIVE', 'ARCHIVED'],
      APPROVED: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
      ACTIVE: ['SUSPENDED', 'ARCHIVED', 'DRAFT'],
      SUSPENDED: ['ACTIVE', 'ARCHIVED'],
      ARCHIVED: ['ACTIVE', 'DRAFT'],
      REJECTED: ['DRAFT'],
      CHANGES_REQUESTED: ['DRAFT'],
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

  @Post(':productId/merge-into/:targetProductId')
  @HttpCode(HttpStatus.OK)
  async mergeProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Param('targetProductId') targetProductId: string,
  ) {
    const adminId = (req as any).adminId;

    // 1. Validate both products exist
    const [sourceProduct, targetProduct] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, isDeleted: false },
        include: {
          variants: { where: { isDeleted: false }, select: { id: true, price: true, stock: true } },
        },
      }),
      this.prisma.product.findFirst({
        where: { id: targetProductId, isDeleted: false },
      }),
    ]);

    if (!sourceProduct) {
      throw new NotFoundAppException('Source product not found');
    }
    if (!targetProduct) {
      throw new NotFoundAppException('Target product not found');
    }

    if (sourceProduct.id === targetProduct.id) {
      throw new BadRequestAppException('Cannot merge a product into itself');
    }

    // 2. The source product is the seller-submitted one — get the seller
    if (!sourceProduct.sellerId) {
      throw new BadRequestAppException('Source product has no associated seller');
    }

    const sellerId = sourceProduct.sellerId;

    // 3. Get seller profile for mapping
    const sellerProfile = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { storeAddress: true, sellerZipCode: true },
    });

    const mappingsCreated: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      // 4. Create SellerProductMapping entries for seller -> target product
      if (sourceProduct.hasVariants && sourceProduct.variants.length > 0) {
        // Get target product variants to map to
        const targetVariants = await tx.productVariant.findMany({
          where: { productId: targetProductId, isDeleted: false },
          select: { id: true, price: true, stock: true },
        });

        if (targetVariants.length > 0) {
          // Map to target variants
          for (const tv of targetVariants) {
            const mapping = await tx.sellerProductMapping.create({
              data: {
                sellerId,
                productId: targetProductId,
                variantId: tv.id,
                stockQty: 0,
                settlementPrice: tv.price ? Number(tv.price) : undefined,
                pickupAddress: sellerProfile?.storeAddress || null,
                pickupPincode: sellerProfile?.sellerZipCode || null,
                dispatchSla: 2,
                isActive: true,
              },
            });
            mappingsCreated.push(mapping);
          }
        } else {
          // No target variants — create product-level mapping
          const mapping = await tx.sellerProductMapping.create({
            data: {
              sellerId,
              productId: targetProductId,
              variantId: null,
              stockQty: sourceProduct.baseStock ?? 0,
              settlementPrice: sourceProduct.basePrice ? Number(sourceProduct.basePrice) : undefined,
              pickupAddress: sellerProfile?.storeAddress || null,
              pickupPincode: sellerProfile?.sellerZipCode || null,
              dispatchSla: 2,
              isActive: true,
            },
          });
          mappingsCreated.push(mapping);
        }
      } else {
        // Simple product — create product-level mapping
        const mapping = await tx.sellerProductMapping.create({
          data: {
            sellerId,
            productId: targetProductId,
            variantId: null,
            stockQty: sourceProduct.baseStock ?? 0,
            settlementPrice: sourceProduct.basePrice ? Number(sourceProduct.basePrice) : undefined,
            pickupAddress: sellerProfile?.storeAddress || null,
            pickupPincode: sellerProfile?.sellerZipCode || null,
            dispatchSla: 2,
            isActive: true,
          },
        });
        mappingsCreated.push(mapping);
      }

      // 5. Soft-delete the source product
      await tx.product.update({
        where: { id: productId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          status: 'ARCHIVED',
        },
      });

      // Soft-delete source variants
      await tx.productVariant.updateMany({
        where: { productId },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      // 6. Create status history entry
      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: sourceProduct.status,
          toStatus: 'ARCHIVED',
          changedBy: adminId,
          reason: `Merged into product ${targetProductId}`,
        },
      });
    });

    this.logger.log(
      `Product ${productId} merged into ${targetProductId} by admin ${adminId}. ${mappingsCreated.length} mapping(s) created.`,
    );

    return {
      success: true,
      message: `Product merged into existing product. ${mappingsCreated.length} seller mapping(s) created.`,
      data: {
        sourceProductId: productId,
        targetProductId,
        mappingsCreated: mappingsCreated.length,
      },
    };
  }

  @Get(':productId/duplicate-info')
  @HttpCode(HttpStatus.OK)
  async getDuplicateInfo(@Param('productId') productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      select: { potentialDuplicateOf: true },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    if (!product.potentialDuplicateOf) {
      return {
        success: true,
        message: 'No potential duplicate found',
        data: null,
      };
    }

    const duplicate = await this.prisma.product.findFirst({
      where: { id: product.potentialDuplicateOf, isDeleted: false },
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 3 },
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
          },
        },
      },
    });

    if (!duplicate) {
      return {
        success: true,
        message: 'Potential duplicate product no longer exists',
        data: null,
      };
    }

    return {
      success: true,
      message: 'Duplicate info retrieved',
      data: {
        id: duplicate.id,
        productCode: duplicate.productCode,
        title: duplicate.title,
        status: duplicate.status,
        moderationStatus: duplicate.moderationStatus,
        basePrice: duplicate.basePrice,
        hasVariants: duplicate.hasVariants,
        brandName: duplicate.brand?.name ?? null,
        categoryName: duplicate.category?.name ?? null,
        images: duplicate.images,
        seller: duplicate.seller,
      },
    };
  }
}
