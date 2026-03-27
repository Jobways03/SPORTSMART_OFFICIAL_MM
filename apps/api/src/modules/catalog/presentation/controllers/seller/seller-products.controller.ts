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
  ForbiddenAppException,
} from '../../../../../core/exceptions';
import { AppException } from '../../../../../core/exceptions/app.exception';
import { SellerAuthGuard } from '../../../../../core/guards';
import { ProductSlugService } from '../../../application/services/product-slug.service';
import { ProductCodeService } from '../../../application/services/product-code.service';
import { ProductOwnershipService } from '../../../application/services/product-ownership.service';
import { ReApprovalService } from '../../../application/services/re-approval.service';
import { DuplicateDetectionService } from '../../../application/services/duplicate-detection.service';
import { CreateProductDto } from '../../dtos/create-product.dto';
import { UpdateProductDto } from '../../dtos/update-product.dto';

@ApiTags('Seller Products')
@Controller('seller/products')
@UseGuards(SellerAuthGuard)
export class SellerProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly slugService: ProductSlugService,
    private readonly productCodeService: ProductCodeService,
    private readonly ownershipService: ProductOwnershipService,
    private readonly reApprovalService: ReApprovalService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
    private readonly eventBus: EventBusService,
  ) {
    this.logger.setContext('SellerProductsController');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Req() req: Request, @Body() dto: CreateProductDto) {
    const sellerId = (req as any).sellerId;

    // Block product creation for non-ACTIVE or email-unverified sellers
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { status: true, isEmailVerified: true },
    });
    if (!seller || seller.status !== 'ACTIVE') {
      throw new ForbiddenAppException(
        'Your account must be approved before you can create products.',
      );
    }
    if (!seller.isEmailVerified) {
      throw new ForbiddenAppException(
        'Please verify your email before creating products.',
      );
    }

    // Sellers CANNOT set platformPrice
    delete (dto as any).platformPrice;

    const slug = await this.slugService.generateUniqueSlug(dto.title);
    const productCode = await this.productCodeService.generateProductCode();

    // Handle categoryName → find or create category
    let resolvedCategoryId = dto.categoryId;
    if (!resolvedCategoryId && dto.categoryName?.trim()) {
      const catSlug = dto.categoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let category = await this.prisma.category.findFirst({
        where: { name: { equals: dto.categoryName.trim(), mode: 'insensitive' } },
      });
      if (!category) {
        category = await this.prisma.category.create({
          data: { name: dto.categoryName.trim(), slug: catSlug },
        });
      }
      resolvedCategoryId = category.id;
    }

    // Handle brandName → find or create brand
    let resolvedBrandId = dto.brandId;
    if (!resolvedBrandId && dto.brandName?.trim()) {
      const brandSlug = dto.brandName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let brand = await this.prisma.brand.findFirst({
        where: { name: { equals: dto.brandName.trim(), mode: 'insensitive' } },
      });
      if (!brand) {
        brand = await this.prisma.brand.create({
          data: { name: dto.brandName.trim(), slug: brandSlug },
        });
      }
      resolvedBrandId = brand.id;
    }

    const product = await this.prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          sellerId,
          productCode,
          title: dto.title,
          slug,
          shortDescription: dto.shortDescription,
          description: dto.description,
          categoryId: resolvedCategoryId,
          brandId: resolvedBrandId,
          hasVariants: dto.hasVariants,
          basePrice: dto.basePrice,
          compareAtPrice: dto.compareAtPrice,
          costPrice: dto.costPrice,
          baseSku: dto.baseSku,
          baseStock: dto.baseStock,
          baseBarcode: dto.baseBarcode,
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

      // Create tags
      if (dto.tags && dto.tags.length > 0) {
        await tx.productTag.createMany({
          data: dto.tags.map((tag) => ({
            productId: newProduct.id,
            tag,
          })),
        });
      }

      // Create SEO
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

      // Create inline variants
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

      // Create status history entry
      await tx.productStatusHistory.create({
        data: {
          productId: newProduct.id,
          fromStatus: null,
          toStatus: 'DRAFT',
          changedBy: sellerId,
          reason: 'Product created',
        },
      });

      return newProduct;
    });

    this.logger.log(`Product created: ${product.id} by seller ${sellerId}`);

    // ── Phase 11 / T3: Auto-create SellerProductMapping for the creator ──
    // When a seller creates their own product, they are automatically mapped
    // as a seller for that product. This connects the old creation flow with
    // the new platform-controlled catalog model.
    try {
      const sellerProfile = await this.prisma.seller.findUnique({
        where: { id: sellerId },
        select: {
          storeAddress: true,
          sellerZipCode: true,
        },
      });

      if (product.hasVariants) {
        // For variant products, create mappings for inline variants
        const createdVariants = await this.prisma.productVariant.findMany({
          where: { productId: product.id, isDeleted: false },
          select: { id: true, price: true, stock: true },
        });

        if (createdVariants.length > 0) {
          for (const variant of createdVariants) {
            await this.prisma.sellerProductMapping.create({
              data: {
                sellerId,
                productId: product.id,
                variantId: variant.id,
                stockQty: variant.stock ?? 0,
                settlementPrice: variant.price ? Number(variant.price) : (product.basePrice ? Number(product.basePrice) : undefined),
                pickupAddress: sellerProfile?.storeAddress || null,
                pickupPincode: sellerProfile?.sellerZipCode || null,
                dispatchSla: 2,
                approvalStatus: 'PENDING_APPROVAL',
                isActive: false,
              },
            });
          }
          this.logger.log(
            `Auto-created ${createdVariants.length} seller mapping(s) for variant product ${product.id} (pending approval)`,
          );
        }
      } else {
        // For simple products, create a single product-level mapping
        await this.prisma.sellerProductMapping.create({
          data: {
            sellerId,
            productId: product.id,
            variantId: null,
            stockQty: product.baseStock ?? 0,
            settlementPrice: product.basePrice ? Number(product.basePrice) : undefined,
            pickupAddress: sellerProfile?.storeAddress || null,
            pickupPincode: sellerProfile?.sellerZipCode || null,
            dispatchSla: 2,
            approvalStatus: 'PENDING_APPROVAL',
            isActive: false,
          },
        });
        this.logger.log(
          `Auto-created seller mapping for simple product ${product.id} (pending approval)`,
        );
      }
    } catch (mappingError) {
      // Log but don't fail product creation if mapping fails
      this.logger.warn(
        `Failed to auto-create seller mapping for product ${product.id}: ${mappingError}`,
      );
    }

    // Fetch full product
    const fullProduct = await this.prisma.product.findUnique({
      where: { id: product.id },
      include: {
        tags: true,
        seo: true,
        variants: true,
        category: true,
        brand: true,
        sellerMappings: true,
      },
    });

    return {
      success: true,
      message: 'Product created successfully. You have been automatically mapped as a seller for this product.',
      data: fullProduct,
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listProducts(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '10', 10) || 10));

    const where: any = {
      sellerId,
      isDeleted: false,
    };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { baseSku: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
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
        categoryName: p.category?.name ?? null,
        brandName: p.brand?.name ?? null,
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
  async getProduct(@Req() req: Request, @Param('productId') productId: string) {
    const sellerId = (req as any).sellerId;

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        sellerId,
        isDeleted: false,
      },
      include: {
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

  @Patch(':productId')
  @HttpCode(HttpStatus.OK)
  async updateProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    const sellerId = (req as any).sellerId;

    // Validate ownership
    await this.ownershipService.validateOwnership(sellerId, productId);

    // Build update data — sellers CANNOT set platformPrice
    delete (dto as any).platformPrice;
    const updateData: any = {};
    if (dto.title !== undefined) {
      updateData.title = dto.title;
      updateData.slug = await this.slugService.generateUniqueSlug(dto.title);
    }
    // Handle categoryName → find or create category
    if (dto.categoryName?.trim()) {
      const catSlug = dto.categoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let category = await this.prisma.category.findFirst({
        where: { name: { equals: dto.categoryName.trim(), mode: 'insensitive' } },
      });
      if (!category) {
        category = await this.prisma.category.create({
          data: { name: dto.categoryName.trim(), slug: catSlug },
        });
      }
      updateData.categoryId = category.id;
    } else if (dto.categoryId !== undefined) {
      updateData.categoryId = dto.categoryId;
    }

    // Handle brandName → find or create brand
    if (dto.brandName?.trim()) {
      const brandSlug = dto.brandName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let brand = await this.prisma.brand.findFirst({
        where: { name: { equals: dto.brandName.trim(), mode: 'insensitive' } },
      });
      if (!brand) {
        brand = await this.prisma.brand.create({
          data: { name: dto.brandName.trim(), slug: brandSlug },
        });
      }
      updateData.brandId = brand.id;
    } else if (dto.brandId !== undefined) {
      updateData.brandId = dto.brandId;
    }

    if (dto.shortDescription !== undefined) updateData.shortDescription = dto.shortDescription;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.hasVariants !== undefined) updateData.hasVariants = dto.hasVariants;
    if (dto.basePrice !== undefined) updateData.basePrice = dto.basePrice;
    if (dto.compareAtPrice !== undefined) updateData.compareAtPrice = dto.compareAtPrice;
    if (dto.costPrice !== undefined) updateData.costPrice = dto.costPrice;
    if (dto.baseSku !== undefined) updateData.baseSku = dto.baseSku;
    if (dto.baseStock !== undefined) updateData.baseStock = dto.baseStock;
    if (dto.baseBarcode !== undefined) updateData.baseBarcode = dto.baseBarcode;
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

      // Replace tags if provided
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

      // Upsert SEO if provided
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

    // Trigger re-approval if product was APPROVED/ACTIVE
    const reApproved = await this.reApprovalService.triggerIfNeeded(productId, sellerId);

    // Fetch full product
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
      message: reApproved
        ? 'Product updated — sent for re-approval'
        : 'Product updated successfully',
      data: fullProduct,
    };
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  async deleteProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
  ) {
    const sellerId = (req as any).sellerId;

    await this.ownershipService.validateOwnership(sellerId, productId);

    const existing = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { status: true },
    });

    const deletableStatuses = ['DRAFT', 'REJECTED'];
    if (!deletableStatuses.includes(existing!.status)) {
      throw new AppException(
        'Product can only be deleted when in DRAFT or REJECTED status',
        'BAD_REQUEST',
      );
    }

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    return {
      success: true,
      message: 'Product deleted successfully',
      data: null,
    };
  }

  @Post(':productId/submit')
  @HttpCode(HttpStatus.OK)
  async submitForReview(
    @Req() req: Request,
    @Param('productId') productId: string,
  ) {
    const sellerId = (req as any).sellerId;

    await this.ownershipService.validateOwnership(sellerId, productId);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        images: true,
        variants: {
          where: { isDeleted: false },
          include: { images: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    const submittableStatuses = ['DRAFT', 'REJECTED', 'CHANGES_REQUESTED'];
    if (!submittableStatuses.includes(product.status)) {
      throw new AppException(
        'Only DRAFT, REJECTED, or CHANGES_REQUESTED products can be submitted for review',
        'BAD_REQUEST',
      );
    }

    // Validation checks
    if (!product.title) {
      throw new BadRequestAppException('Product must have a title');
    }

    if (!product.categoryId) {
      throw new BadRequestAppException('Product must have a category');
    }

    // For variant products, accept either product-level or variant-level images
    const hasProductImages = product.images.length > 0;
    const hasVariantImages = product.hasVariants &&
      product.variants.some((v) => v.images.length > 0);

    if (!hasProductImages && !hasVariantImages) {
      throw new BadRequestAppException('Product must have at least 1 image');
    }

    if (product.hasVariants) {
      if (product.variants.length === 0) {
        throw new BadRequestAppException(
          'Product with variants must have at least 1 variant',
        );
      }
      const hasVariantWithPrice = product.variants.some(
        (v) => v.price !== null && Number(v.price) > 0,
      );
      if (!hasVariantWithPrice) {
        throw new BadRequestAppException(
          'At least 1 variant must have a price',
        );
      }
    } else {
      if (!product.basePrice || Number(product.basePrice) <= 0) {
        throw new BadRequestAppException(
          'Simple product must have a base price',
        );
      }
    }

    // Run duplicate detection
    let potentialDuplicates: any[] = [];
    try {
      potentialDuplicates = await this.duplicateDetectionService.findPotentialDuplicates({
        title: product.title,
        brandId: product.brandId ?? undefined,
        categoryId: product.categoryId ?? undefined,
      });
    } catch (err) {
      this.logger.warn(`Duplicate detection failed for product ${productId}: ${err}`);
    }

    const bestMatchId = potentialDuplicates.length > 0 ? potentialDuplicates[0].productId : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: 'SUBMITTED',
          moderationStatus: 'PENDING',
          ...(bestMatchId ? { potentialDuplicateOf: bestMatchId } : {}),
        },
      });

      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: product.status,
          toStatus: 'SUBMITTED',
          changedBy: sellerId,
          reason: 'Submitted for review',
        },
      });
    });

    // Emit event for admin notification
    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.submitted_for_qc',
        aggregate: 'Product',
        aggregateId: productId,
        occurredAt: new Date(),
        payload: {
          productId,
          productTitle: product.title,
          sellerId,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.submitted_for_qc event: ${err}`);
    }

    return {
      success: true,
      message: 'Product submitted for review',
      data: {
        product: { id: productId },
        potentialDuplicates,
      },
    };
  }
}
