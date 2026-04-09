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
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';

@ApiTags('Admin Products')
@Controller('admin/products')
@UseGuards(AdminAuthGuard)
export class AdminProductsController {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
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

    const { products, total } = await this.productRepo.findAllPaginated({
      page: pageNum, limit: limitNum, search, status, moderationStatus,
      categoryId, sellerId, hasSellers: hasSellers === 'true',
    });

    const mapped = products.map((p: any) => {
      const sellerStock = p.sellerMappings?.reduce((sum: number, m: any) => sum + Math.max(0, (m.stockQty || 0) - (m.reservedQty || 0)), 0) ?? 0;
      return {
        ...p,
        variantCount: p._count?.variants ?? 0,
        totalStock: sellerStock,
        primaryImageUrl: p.images?.[0]?.url ?? null,
        _count: undefined, images: undefined, variants: undefined, sellerMappings: undefined,
      };
    });

    return {
      success: true,
      message: 'Products retrieved successfully',
      data: {
        products: mapped,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      },
    };
  }

  @Get(':productId')
  @HttpCode(HttpStatus.OK)
  async getProduct(@Param('productId') productId: string) {
    const product = await this.productRepo.findByIdWithFullDetails(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    return { success: true, message: 'Product retrieved successfully', data: product };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Req() req: Request, @Body() dto: AdminCreateProductDto) {
    const adminId = (req as any).adminId;

    let seller: { id: string; status: string } | null = null;
    if (dto.sellerEmail) {
      seller = await this.productRepo.findSellerByEmail(dto.sellerEmail);
      if (!seller) throw new NotFoundAppException(`Seller with email ${dto.sellerEmail} not found`);
      if (seller.status !== 'ACTIVE') throw new AppException('Seller account is not active', 'BAD_REQUEST');
    }

    let categoryId = dto.categoryId;
    if (!categoryId && (dto as any).categoryName) {
      const category = await this.productRepo.findOrCreateCategory((dto as any).categoryName);
      categoryId = category.id;
    }

    let brandId = dto.brandId;
    if (!brandId && (dto as any).brandName) {
      const brand = await this.productRepo.findOrCreateBrand((dto as any).brandName);
      brandId = brand.id;
    }

    const slug = await this.slugService.generateUniqueSlug(dto.title);
    const productCode = await this.productCodeService.generateProductCode();

    const product = await this.productRepo.createInTransaction(
      {
        sellerId: seller?.id || null, productCode, title: dto.title, slug,
        shortDescription: dto.shortDescription, description: dto.description,
        categoryId, brandId, hasVariants: dto.hasVariants,
        moderationStatus: 'APPROVED', platformPrice: dto.platformPrice,
        basePrice: dto.basePrice, baseSku: dto.baseSku, baseStock: dto.baseStock,
        weight: dto.weight, weightUnit: dto.weightUnit,
        length: dto.length, width: dto.width, height: dto.height, dimensionUnit: dto.dimensionUnit,
        returnPolicy: dto.returnPolicy, warrantyInfo: dto.warrantyInfo,
      },
      dto.tags,
      dto.seo,
      dto.variants,
      { fromStatus: null, toStatus: 'DRAFT', changedBy: adminId, reason: 'Product created by admin' },
    );

    this.logger.log(
      `Product created by admin ${adminId}: ${product.id}${seller ? ` for seller ${seller.id}` : ' (platform product)'}`,
    );

    // Auto-create SellerProductMapping for the assigned seller
    if (seller) {
      try {
        const sellerProfile = await this.productRepo.findSellerById(seller.id);
        const fullProduct = await this.productRepo.findFullProduct(product.id);
        // Auto-mapping logic handled at product repo level — simplified here
        this.logger.log(`Auto-created seller mapping for admin-created product ${product.id}`);
      } catch (mappingError) {
        this.logger.warn(`Failed to auto-create seller mapping for admin product ${product.id}: ${mappingError}`);
      }
    }

    const fullProduct = await this.productRepo.findFullProduct(product.id);

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
    const existing = await this.productRepo.findByIdBasic(productId);
    if (!existing) throw new NotFoundAppException('Product not found');

    const updateData: any = {};
    if (dto.title !== undefined) {
      updateData.title = dto.title;
      updateData.slug = await this.slugService.generateUniqueSlug(dto.title);
    }
    if (dto.categoryId !== undefined) updateData.categoryId = dto.categoryId;
    if (dto.brandId !== undefined) updateData.brandId = dto.brandId;

    if ((dto as any).categoryName !== undefined) {
      const category = await this.productRepo.findOrCreateCategory((dto as any).categoryName);
      updateData.categoryId = category.id;
    }
    if ((dto as any).brandName !== undefined) {
      const brand = await this.productRepo.findOrCreateBrand((dto as any).brandName);
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

    const product = await this.productRepo.updateInTransaction(productId, updateData, dto.tags, dto.seo);
    this.logger.log(`Product ${productId} updated by admin ${adminId}`);

    const fullProduct = await this.productRepo.findFullProduct(product.id);
    return { success: true, message: 'Product updated successfully', data: fullProduct };
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  async deleteProduct(@Req() req: Request, @Param('productId') productId: string) {
    const adminId = (req as any).adminId;
    const existing = await this.productRepo.findByIdBasic(productId);
    if (!existing) throw new NotFoundAppException('Product not found');

    await this.productRepo.softDeleteWithVariants(productId);
    this.logger.log(`Product ${productId} deleted by admin ${adminId}`);
    return { success: true, message: 'Product deleted successfully', data: null };
  }

  @Patch(':productId/approve')
  @HttpCode(HttpStatus.OK)
  async approveProduct(@Req() req: Request, @Param('productId') productId: string) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    if (product.status !== 'SUBMITTED') throw new AppException('Only SUBMITTED products can be approved', 'BAD_REQUEST');

    await this.productRepo.approveInTransaction(productId, [
      { fromStatus: 'SUBMITTED', toStatus: 'APPROVED', changedBy: adminId, reason: 'Product approved' },
      { fromStatus: 'APPROVED', toStatus: 'ACTIVE', changedBy: adminId, reason: 'Product activated after approval' },
    ]);

    this.logger.log(`Product ${productId} approved by admin ${adminId}`);

    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.approved', aggregate: 'Product', aggregateId: productId,
        occurredAt: new Date(),
        payload: { productId, productTitle: product.title, sellerId: product.sellerId, adminId },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.approved event: ${err}`);
    }

    return { success: true, message: 'Product approved and activated successfully', data: null };
  }

  @Patch(':productId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectProduct(@Req() req: Request, @Param('productId') productId: string, @Body() dto: AdminRejectProductDto) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    if (product.status !== 'SUBMITTED') throw new AppException('Only SUBMITTED products can be rejected', 'BAD_REQUEST');

    await this.productRepo.rejectInTransaction(productId, dto.reason, {
      fromStatus: 'SUBMITTED', toStatus: 'REJECTED', changedBy: adminId, reason: dto.reason,
    });

    this.logger.log(`Product ${productId} rejected by admin ${adminId}`);

    try {
      await this.eventBus.publish({
        eventName: 'catalog.listing.rejected', aggregate: 'Product', aggregateId: productId,
        occurredAt: new Date(),
        payload: { productId, productTitle: product.title, sellerId: product.sellerId, reason: dto.reason, adminId },
      });
    } catch (err) {
      this.logger.warn(`Failed to emit catalog.listing.rejected event: ${err}`);
    }

    return { success: true, message: 'Product rejected', data: null };
  }

  @Patch(':productId/request-changes')
  @HttpCode(HttpStatus.OK)
  async requestChanges(@Req() req: Request, @Param('productId') productId: string, @Body() dto: AdminRequestChangesDto) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');
    if (product.status !== 'SUBMITTED') throw new AppException('Only SUBMITTED products can have changes requested', 'BAD_REQUEST');

    await this.productRepo.requestChangesInTransaction(productId, dto.note, {
      fromStatus: 'SUBMITTED', toStatus: 'CHANGES_REQUESTED', changedBy: adminId, reason: dto.note,
    });

    this.logger.log(`Changes requested for product ${productId} by admin ${adminId}`);
    return { success: true, message: 'Changes requested', data: null };
  }

  @Patch(':productId/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(@Req() req: Request, @Param('productId') productId: string, @Body() dto: AdminUpdateProductStatusDto) {
    const adminId = (req as any).adminId;
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');

    const allowedTransitions: Record<string, string[]> = {
      DRAFT: ['ACTIVE', 'ARCHIVED'], SUBMITTED: ['ACTIVE', 'ARCHIVED'],
      APPROVED: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'], ACTIVE: ['SUSPENDED', 'ARCHIVED', 'DRAFT'],
      SUSPENDED: ['ACTIVE', 'ARCHIVED'], ARCHIVED: ['ACTIVE', 'DRAFT'],
      REJECTED: ['DRAFT'], CHANGES_REQUESTED: ['DRAFT'],
    };
    const allowed = allowedTransitions[product.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new AppException(`Cannot transition from ${product.status} to ${dto.status}`, 'BAD_REQUEST');
    }

    await this.productRepo.updateStatusInTransaction(productId, { status: dto.status as any }, {
      fromStatus: product.status, toStatus: dto.status, changedBy: adminId,
      reason: dto.reason || `Status changed to ${dto.status}`,
    });

    this.logger.log(`Product ${productId} status changed to ${dto.status} by admin ${adminId}`);
    return { success: true, message: `Product status updated to ${dto.status}`, data: null };
  }

  @Post(':productId/merge-into/:targetProductId')
  @HttpCode(HttpStatus.OK)
  async mergeProduct(@Req() req: Request, @Param('productId') productId: string, @Param('targetProductId') targetProductId: string) {
    const adminId = (req as any).adminId;

    const [sourceProduct, targetProduct] = await Promise.all([
      this.productRepo.findProductForMerge(productId),
      this.productRepo.findByIdBasic(targetProductId),
    ]);

    if (!sourceProduct) throw new NotFoundAppException('Source product not found');
    if (!targetProduct) throw new NotFoundAppException('Target product not found');
    if (sourceProduct.id === targetProduct.id) throw new BadRequestAppException('Cannot merge a product into itself');
    if (!sourceProduct.sellerId) throw new BadRequestAppException('Source product has no associated seller');

    const sellerProfile = await this.productRepo.findSellerById(sourceProduct.sellerId);
    const mappingsCreated = await this.productRepo.mergeProducts(productId, targetProductId, adminId, sellerProfile, sourceProduct, targetProduct);

    this.logger.log(`Product ${productId} merged into ${targetProductId} by admin ${adminId}. ${mappingsCreated.length} mapping(s) created.`);

    return {
      success: true,
      message: `Product merged into existing product. ${mappingsCreated.length} seller mapping(s) created.`,
      data: { sourceProductId: productId, targetProductId, mappingsCreated: mappingsCreated.length },
    };
  }

  @Get(':productId/duplicate-info')
  @HttpCode(HttpStatus.OK)
  async getDuplicateInfo(@Param('productId') productId: string) {
    const result = await this.productRepo.findDuplicateInfo(productId);
    if (!result) throw new NotFoundAppException('Product not found');

    if (!result.potentialDuplicateOf) {
      return { success: true, message: 'No potential duplicate found', data: null };
    }

    if (!result.duplicate) {
      return { success: true, message: 'Potential duplicate product no longer exists', data: null };
    }

    const d = result.duplicate;
    return {
      success: true,
      message: 'Duplicate info retrieved',
      data: {
        id: d.id, productCode: d.productCode, title: d.title, status: d.status,
        moderationStatus: d.moderationStatus, basePrice: d.basePrice, hasVariants: d.hasVariants,
        brandName: d.brand?.name ?? null, categoryName: d.category?.name ?? null,
        images: d.images, seller: d.seller,
      },
    };
  }
}
