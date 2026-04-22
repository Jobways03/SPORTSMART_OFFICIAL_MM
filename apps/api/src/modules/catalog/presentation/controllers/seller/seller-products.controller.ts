import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
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
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../../domain/repositories/variant.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';

@ApiTags('Seller Products')
@Controller('seller/products')
@UseGuards(SellerAuthGuard)
export class SellerProductsController {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
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
    const seller = await this.productRepo.findSellerById(sellerId);
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

    // Sellers cannot set admin-internal pricing fields (procurementPrice
    // is the platform's negotiated landed cost, not the seller's price).
    delete (dto as any).platformPrice; // obsolete — safe to drop if present
    delete (dto as any).procurementPrice;

    const slug = await this.slugService.generateUniqueSlug(dto.title);
    const productCode = await this.productCodeService.generateProductCode();

    // Handle categoryName → find or create category
    let resolvedCategoryId = dto.categoryId;
    if (!resolvedCategoryId && dto.categoryName?.trim()) {
      const category = await this.productRepo.findOrCreateCategory(dto.categoryName.trim());
      resolvedCategoryId = category.id;
    }

    // Handle brandName → find or create brand
    let resolvedBrandId = dto.brandId;
    if (!resolvedBrandId && dto.brandName?.trim()) {
      const brand = await this.productRepo.findOrCreateBrand(dto.brandName.trim());
      resolvedBrandId = brand.id;
    }

    const product = await this.productRepo.createInTransaction(
      {
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
      dto.tags,
      dto.seo,
      dto.variants,
      {
        fromStatus: null,
        toStatus: 'DRAFT',
        changedBy: sellerId,
        reason: 'Product created',
      },
    );

    this.logger.log(`Product created: ${product.id} by seller ${sellerId}`);

    // ── Phase 11 / T3: Auto-create SellerProductMapping for the creator ──
    try {
      const sellerProfile = await this.productRepo.findSellerById(sellerId);

      if (product.hasVariants) {
        const createdVariants = await this.variantRepo.findByProductId(product.id);

        if (createdVariants.length > 0) {
          for (const variant of createdVariants) {
            await this.sellerMappingRepo.create({
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
            });
          }
          this.logger.log(
            `Auto-created ${createdVariants.length} seller mapping(s) for variant product ${product.id} (pending approval)`,
          );
        }
      } else {
        await this.sellerMappingRepo.create({
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
        });
        this.logger.log(
          `Auto-created seller mapping for simple product ${product.id} (pending approval)`,
        );
      }
    } catch (mappingError) {
      this.logger.warn(
        `Failed to auto-create seller mapping for product ${product.id}: ${mappingError}`,
      );
    }

    // Fetch full product
    const fullProduct = await this.productRepo.findFullProduct(product.id);

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

    const { products, total } = await this.productRepo.findBySellerPaginated({
      sellerId,
      page: pageNum,
      limit: limitNum,
      status,
      search,
      categoryId,
    });

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

    const product = await this.productRepo.findByIdForSeller(productId, sellerId);

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

    // Build update data — sellers cannot set admin-internal pricing
    // (procurementPrice is platform-side; platformPrice is obsolete).
    delete (dto as any).platformPrice;
    delete (dto as any).procurementPrice;

    // Fetch current product to compare values — only include fields that actually changed
    const current = await this.productRepo.findByIdBasic(productId);

    const updateData: any = {};
    if (dto.title !== undefined && dto.title !== current?.title) {
      updateData.title = dto.title;
      updateData.slug = await this.slugService.generateUniqueSlug(dto.title);
    }
    // Handle categoryName → find or create category
    if (dto.categoryName?.trim()) {
      const category = await this.productRepo.findOrCreateCategory(dto.categoryName.trim());
      if (category.id !== current?.categoryId) updateData.categoryId = category.id;
    } else if (dto.categoryId !== undefined && dto.categoryId !== current?.categoryId) {
      updateData.categoryId = dto.categoryId;
    }

    // Handle brandName → find or create brand
    if (dto.brandName?.trim()) {
      const brand = await this.productRepo.findOrCreateBrand(dto.brandName.trim());
      if (brand.id !== current?.brandId) updateData.brandId = brand.id;
    } else if (dto.brandId !== undefined && dto.brandId !== current?.brandId) {
      updateData.brandId = dto.brandId;
    }

    const simpleFields: Array<{ key: string; dtoKey: keyof typeof dto }> = [
      { key: 'shortDescription', dtoKey: 'shortDescription' },
      { key: 'description', dtoKey: 'description' },
      { key: 'hasVariants', dtoKey: 'hasVariants' },
      { key: 'basePrice', dtoKey: 'basePrice' },
      { key: 'compareAtPrice', dtoKey: 'compareAtPrice' },
      { key: 'costPrice', dtoKey: 'costPrice' },
      { key: 'baseSku', dtoKey: 'baseSku' },
      { key: 'baseStock', dtoKey: 'baseStock' },
      { key: 'baseBarcode', dtoKey: 'baseBarcode' },
      { key: 'weight', dtoKey: 'weight' },
      { key: 'weightUnit', dtoKey: 'weightUnit' },
      { key: 'length', dtoKey: 'length' },
      { key: 'width', dtoKey: 'width' },
      { key: 'height', dtoKey: 'height' },
      { key: 'dimensionUnit', dtoKey: 'dimensionUnit' },
      { key: 'returnPolicy', dtoKey: 'returnPolicy' },
      { key: 'warrantyInfo', dtoKey: 'warrantyInfo' },
    ];
    for (const { key, dtoKey } of simpleFields) {
      const dtoVal = dto[dtoKey];
      if (dtoVal !== undefined) {
        // Compare with type coercion for Decimal fields
        const curVal = current?.[key];
        const dtoStr = String(dtoVal ?? '');
        const curStr = String(curVal ?? '');
        if (dtoStr !== curStr) {
          updateData[key] = dtoVal;
        }
      }
    }

    // Compare tags — only include if actually different
    let tagsChanged = false;
    if (dto.tags !== undefined && current) {
      const currentProduct = await this.productRepo.findFullProduct(productId);
      const currentTags = (currentProduct?.tags || []).map((t: any) => t.tag || t).sort();
      const newTags = [...dto.tags].sort();
      tagsChanged = JSON.stringify(currentTags) !== JSON.stringify(newTags);
    }

    // Compare SEO — only include if actually different
    let seoChanged = false;
    if (dto.seo !== undefined && current) {
      const currentProduct = await this.productRepo.findFullProduct(productId);
      const curSeo = currentProduct?.seo;
      if (curSeo) {
        seoChanged = (dto.seo.metaTitle !== curSeo.metaTitle) ||
          (dto.seo.metaDescription !== curSeo.metaDescription) ||
          (dto.seo.metaKeywords !== curSeo.metaKeywords);
      } else {
        seoChanged = !!(dto.seo.metaTitle || dto.seo.metaDescription || dto.seo.metaKeywords);
      }
    }

    // If nothing actually changed, return early without triggering re-approval
    if (Object.keys(updateData).length === 0 && !tagsChanged && !seoChanged) {
      const fullProduct = await this.productRepo.findFullProduct(productId);
      return {
        success: true,
        message: 'No changes detected',
        data: fullProduct,
      };
    }

    const product = await this.productRepo.updateInTransaction(
      productId,
      updateData,
      tagsChanged ? dto.tags : undefined,
      seoChanged ? dto.seo : undefined,
    );

    // Trigger re-approval only if content fields actually changed. The
    // classifier treats price / inventory / physical / policy fields as
    // self-serve (stay LIVE); anything else forces a fresh admin review.
    // Tags + SEO always count as content when present.
    const changedFields = Object.keys(updateData).filter((k) => k !== 'slug');
    if (tagsChanged) changedFields.push('tags');
    if (seoChanged) changedFields.push('seo');
    const reApproved = await this.reApprovalService.triggerIfNeeded(
      productId,
      sellerId,
      { changedFields },
    );

    // Fetch full product
    const fullProduct = await this.productRepo.findFullProduct(product.id);

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

    const existing = await this.productRepo.findByIdBasic(productId);

    const deletableStatuses = ['DRAFT', 'REJECTED'];
    if (!deletableStatuses.includes(existing!.status)) {
      throw new AppException(
        'Product can only be deleted when in DRAFT or REJECTED status',
        'BAD_REQUEST',
      );
    }

    await this.productRepo.softDelete(productId);

    return {
      success: true,
      message: 'Product deleted successfully',
      data: null,
    };
  }

  /**
   * Seller self-service pause/resume. Tightly scoped: only ACTIVE <-> SUSPENDED.
   * Any other transition (archive / reject / etc.) still requires admin action.
   * This lets the seller quickly stop sales on a live product without a
   * support ticket — e.g. if stock runs out or they spot a listing issue.
   */
  @Patch(':productId/self-status')
  @HttpCode(HttpStatus.OK)
  async updateSelfStatus(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() body: { status: 'ACTIVE' | 'SUSPENDED'; reason?: string },
  ) {
    const sellerId = (req as any).sellerId;

    await this.ownershipService.validateOwnership(sellerId, productId);

    const target = body?.status;
    if (target !== 'ACTIVE' && target !== 'SUSPENDED') {
      throw new AppException(
        "status must be 'ACTIVE' or 'SUSPENDED'",
        'BAD_REQUEST',
      );
    }

    const existing = await this.productRepo.findByIdBasic(productId);
    if (!existing) {
      throw new NotFoundAppException('Product not found');
    }

    const allowed: Record<string, string[]> = {
      ACTIVE: ['SUSPENDED'],
      SUSPENDED: ['ACTIVE'],
    };
    const legal = allowed[existing.status]?.includes(target);
    if (!legal) {
      throw new AppException(
        `Cannot transition from ${existing.status} to ${target}. Self-service only supports ACTIVE <-> SUSPENDED.`,
        'BAD_REQUEST',
      );
    }

    await this.productRepo.updateStatusInTransaction(
      productId,
      { status: target },
      {
        fromStatus: existing.status,
        toStatus: target,
        changedBy: sellerId,
        reason:
          body?.reason ||
          (target === 'SUSPENDED'
            ? 'Seller paused the listing'
            : 'Seller resumed the listing'),
      },
    );

    this.logger.log(
      `Seller ${sellerId} self-transitioned product ${productId}: ${existing.status} -> ${target}`,
    );

    return {
      success: true,
      message: target === 'SUSPENDED' ? 'Product paused' : 'Product resumed',
      data: { productId, status: target },
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

    const product = await this.productRepo.findByIdForSeller(productId, sellerId);

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
      product.variants.some((v: any) => v.images.length > 0);

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
        (v: any) => v.price !== null && Number(v.price) > 0,
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
        excludeProductId: productId,
      });
    } catch (err) {
      this.logger.warn(`Duplicate detection failed for product ${productId}: ${err}`);
    }

    const bestMatchId = potentialDuplicates.length > 0 ? potentialDuplicates[0].productId : null;

    await this.productRepo.submitForReviewInTransaction(
      productId,
      {
        status: 'SUBMITTED',
        moderationStatus: 'PENDING',
        ...(bestMatchId ? { potentialDuplicateOf: bestMatchId } : {}),
      },
      {
        fromStatus: product.status,
        toStatus: 'SUBMITTED',
        changedBy: sellerId,
        reason: 'Submitted for review',
      },
    );

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
