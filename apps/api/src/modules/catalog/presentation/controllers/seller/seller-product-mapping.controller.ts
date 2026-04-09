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
import {
  NotFoundAppException,
  BadRequestAppException,
  ForbiddenAppException,
  ConflictAppException,
} from '../../../../../core/exceptions';
import { SellerAuthGuard } from '../../../../../core/guards';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';

// ─── DTOs (inline for this controller) ───────────────────────────────

interface MapProductDto {
  productId: string;
  variantId?: string;
  stockQty: number;
  settlementPrice?: number;
  procurementCost?: number;
  sellerInternalSku?: string;
  pickupAddress?: string;
  pickupPincode?: string;
  latitude?: number;
  longitude?: number;
  dispatchSla?: number;
}

interface UpdateMappingDto {
  stockQty?: number;
  sellerInternalSku?: string;
  settlementPrice?: number;
  procurementCost?: number;
  pickupAddress?: string;
  pickupPincode?: string;
  latitude?: number;
  longitude?: number;
  dispatchSla?: number;
  isActive?: boolean;
  lowStockThreshold?: number;
}

interface BulkStockUpdateDto {
  updates: { mappingId: string; stockQty: number }[];
}

@ApiTags('Seller Catalog')
@Controller('seller/catalog')
@UseGuards(SellerAuthGuard)
export class SellerProductMappingController {
  constructor(
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SellerProductMappingController');
  }

  // ─── T2: Browse master product catalog ────────────────────────────

  @Get('browse')
  @HttpCode(HttpStatus.OK)
  async browseCatalog(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const { products, total } = await this.storefrontRepo.findBrowsableProducts(
      sellerId, pageNum, limitNum, search, categoryId, brandId,
    );

    const mapped = products.map((p: any) => ({
      id: p.id,
      productCode: p.productCode,
      title: p.title,
      slug: p.slug,
      hasVariants: p.hasVariants,
      basePrice: p.basePrice,
      categoryName: p.category?.name ?? null,
      categoryId: p.category?.id ?? null,
      brandName: p.brand?.name ?? null,
      brandId: p.brand?.id ?? null,
      primaryImageUrl: p.images?.[0]?.url ?? null,
      variantCount: p._count?.variants ?? 0,
    }));

    return {
      success: true,
      message: 'Catalog products retrieved successfully',
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

  // ─── T3: Map self to a product ────────────────────────────────────

  @Post('map')
  @HttpCode(HttpStatus.CREATED)
  async mapProduct(@Req() req: Request, @Body() dto: MapProductDto) {
    const sellerId = (req as any).sellerId;

    if (!dto.productId) {
      throw new BadRequestAppException('productId is required');
    }
    if (dto.stockQty === undefined || dto.stockQty === null) {
      throw new BadRequestAppException('stockQty is required');
    }
    if (dto.stockQty < 0) {
      throw new BadRequestAppException('stockQty must be >= 0');
    }

    // Validate product exists and is ACTIVE
    const product = await this.sellerMappingRepo.findProductForMapping(dto.productId);

    if (!product || product.isDeleted) {
      throw new NotFoundAppException('Product not found');
    }

    if (product.status !== 'ACTIVE') {
      throw new BadRequestAppException(
        'Only ACTIVE products can be mapped. Current status: ' + product.status,
      );
    }

    // If variant specified, validate it exists and belongs to this product
    if (dto.variantId) {
      const variant = await this.sellerMappingRepo.findVariantForMapping(dto.variantId, dto.productId);
      if (!variant) {
        throw new NotFoundAppException(
          'Variant not found or does not belong to this product',
        );
      }
    }

    // Auto-lookup coordinates from PostOffice table if pincode provided but no lat/lng
    let resolvedLat = dto.latitude ?? null;
    let resolvedLon = dto.longitude ?? null;
    if (dto.pickupPincode && (resolvedLat == null || resolvedLon == null)) {
      const postOffice = await this.sellerMappingRepo.findPostOfficeByPincode(dto.pickupPincode);
      if (postOffice?.latitude && postOffice?.longitude) {
        resolvedLat = Number(postOffice.latitude);
        resolvedLon = Number(postOffice.longitude);
      }
    }

    // Build common mapping data
    const baseMappingData = {
      sellerId,
      productId: dto.productId,
      stockQty: dto.stockQty,
      settlementPrice: dto.settlementPrice,
      procurementCost: dto.procurementCost,
      sellerInternalSku: dto.sellerInternalSku,
      pickupAddress: dto.pickupAddress,
      pickupPincode: dto.pickupPincode,
      latitude: resolvedLat,
      longitude: resolvedLon,
      dispatchSla: dto.dispatchSla ?? 2,
      approvalStatus: 'PENDING_APPROVAL' as const,
      isActive: false,
    };

    // Determine mapping strategy
    if (product.hasVariants && !dto.variantId) {
      // Map to ALL variants of the product
      if (product.variants.length === 0) {
        throw new BadRequestAppException(
          'Product is marked as having variants but has no active variants',
        );
      }

      // Check for any existing mappings for this seller + product
      const existingMappings = await this.sellerMappingRepo.findBySellerForProduct(sellerId, dto.productId);
      const existingVariantIds = new Set(
        existingMappings.map((m: any) => m.variantId),
      );

      const variantsToMap = product.variants.filter(
        (v: any) => !existingVariantIds.has(v.id),
      );

      if (variantsToMap.length === 0) {
        throw new ConflictAppException(
          'You have already mapped all variants of this product',
        );
      }

      const createdMappings = await this.sellerMappingRepo.createMany(
        variantsToMap.map((variant: any) => ({
          ...baseMappingData,
          variantId: variant.id,
        })),
      );

      this.logger.log(
        `Seller ${sellerId} mapped to product ${dto.productId} — ${createdMappings.length} variant mapping(s) created`,
      );

      return {
        success: true,
        message: `Mapped to ${createdMappings.length} variant(s) successfully`,
        data: createdMappings,
      };
    } else {
      // Single mapping (simple product or specific variant)
      const variantId = dto.variantId || null;

      // Check for duplicate
      const existing = await this.sellerMappingRepo.findBySellerAndProduct(sellerId, dto.productId, variantId);

      if (existing) {
        throw new ConflictAppException(
          'You have already mapped to this product' +
            (variantId ? ' variant' : ''),
        );
      }

      const mapping = await this.sellerMappingRepo.create({
        ...baseMappingData,
        variantId,
      });

      this.logger.log(
        `Seller ${sellerId} mapped to product ${dto.productId}${variantId ? ` variant ${variantId}` : ''}`,
      );

      return {
        success: true,
        message: 'Product mapped successfully',
        data: mapping,
      };
    }
  }

  // ─── T7 (prep): My mapped products ────────────────────────────────

  @Get('my-products')
  @HttpCode(HttpStatus.OK)
  async myProducts(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const { products, total } = await this.sellerMappingRepo.findMyProductsPaginated(
      sellerId, pageNum, limitNum, search,
    );

    const mapped = products.map((p: any) => ({
      id: p.id,
      productCode: p.productCode,
      title: p.title,
      slug: p.slug,
      hasVariants: p.hasVariants,
      basePrice: p.basePrice,
      status: p.status,
      categoryName: p.category?.name ?? null,
      brandName: p.brand?.name ?? null,
      primaryImageUrl: p.images?.[0]?.url ?? null,
      mappings: p.sellerMappings.map((m: any) => ({
        id: m.id,
        variantId: m.variantId,
        variantSku: m.variant?.sku ?? null,
        variantPrice: m.variant?.price ?? null,
        variantOptions: m.variant?.optionValues?.map((ov: any) => ({
          option: ov.optionValue?.optionDefinition?.name,
          value: ov.optionValue?.value,
        })) ?? [],
        stockQty: m.stockQty,
        reservedQty: m.reservedQty,
        sellerInternalSku: m.sellerInternalSku,
        settlementPrice: m.settlementPrice,
        procurementCost: m.procurementCost,
        pickupAddress: m.pickupAddress,
        pickupPincode: m.pickupPincode,
        dispatchSla: m.dispatchSla,
        isActive: m.isActive,
        approvalStatus: m.approvalStatus,
        operationalPriority: m.operationalPriority,
        lowStockThreshold: m.lowStockThreshold,
        createdAt: m.createdAt,
      })),
    }));

    return {
      success: true,
      message: 'My mapped products retrieved successfully',
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

  // ─── T8: Bulk stock update ─────────────────────────────────────────

  @Patch('mapping/bulk-stock')
  @HttpCode(HttpStatus.OK)
  async bulkStockUpdate(@Req() req: Request, @Body() dto: BulkStockUpdateDto) {
    const sellerId = (req as any).sellerId;

    if (!dto.updates || !Array.isArray(dto.updates) || dto.updates.length === 0) {
      throw new BadRequestAppException(
        'updates array is required and must not be empty',
      );
    }

    if (dto.updates.length > 100) {
      throw new BadRequestAppException(
        'Maximum 100 updates per request',
      );
    }

    // Validate all stock quantities
    for (const update of dto.updates) {
      if (!update.mappingId) {
        throw new BadRequestAppException('Each update must have a mappingId');
      }
      if (update.stockQty === undefined || update.stockQty === null) {
        throw new BadRequestAppException(
          `stockQty is required for mapping ${update.mappingId}`,
        );
      }
      if (update.stockQty < 0) {
        throw new BadRequestAppException(
          `stockQty must be >= 0 for mapping ${update.mappingId}`,
        );
      }
    }

    const mappingIds = dto.updates.map((u) => u.mappingId);

    // Validate all mappings belong to this seller
    for (const mappingId of mappingIds) {
      const mapping = await this.sellerMappingRepo.findById(mappingId);
      if (!mapping) {
        throw new NotFoundAppException(`Mapping ${mappingId} not found`);
      }
      if (mapping.sellerId !== sellerId) {
        throw new ForbiddenAppException(
          `You do not have permission to update mapping ${mappingId}`,
        );
      }
    }

    // Perform bulk update
    const updated = await this.sellerMappingRepo.bulkUpdateStock(dto.updates);

    this.logger.log(
      `Bulk stock update: ${updated.length} mappings updated by seller ${sellerId}`,
    );

    return {
      success: true,
      message: `${updated.length} mapping(s) stock updated successfully`,
      data: updated,
    };
  }

  // ─── T4: Update a mapping ─────────────────────────────────────────

  @Patch('mapping/:mappingId')
  @HttpCode(HttpStatus.OK)
  async updateMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: UpdateMappingDto,
  ) {
    const sellerId = (req as any).sellerId;

    const existing = await this.sellerMappingRepo.findById(mappingId);

    if (!existing) {
      throw new NotFoundAppException('Mapping not found');
    }

    if (existing.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You do not have permission to update this mapping',
      );
    }

    // Build update data — only set fields that are explicitly provided
    const updateData: any = {};
    if (dto.stockQty !== undefined) {
      if (dto.stockQty < 0) {
        throw new BadRequestAppException('stockQty must be >= 0');
      }
      updateData.stockQty = dto.stockQty;
    }
    if (dto.sellerInternalSku !== undefined) updateData.sellerInternalSku = dto.sellerInternalSku;
    if (dto.settlementPrice !== undefined) updateData.settlementPrice = dto.settlementPrice;
    if (dto.procurementCost !== undefined) updateData.procurementCost = dto.procurementCost;
    if (dto.pickupAddress !== undefined) updateData.pickupAddress = dto.pickupAddress;
    if (dto.pickupPincode !== undefined) updateData.pickupPincode = dto.pickupPincode;
    if (dto.latitude !== undefined) updateData.latitude = dto.latitude;
    if (dto.longitude !== undefined) updateData.longitude = dto.longitude;
    if (dto.dispatchSla !== undefined) {
      if (dto.dispatchSla < 0) {
        throw new BadRequestAppException('dispatchSla must be >= 0');
      }
      updateData.dispatchSla = dto.dispatchSla;
    }
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.lowStockThreshold !== undefined) {
      if (dto.lowStockThreshold < 0) {
        throw new BadRequestAppException('lowStockThreshold must be >= 0');
      }
      updateData.lowStockThreshold = dto.lowStockThreshold;
    }

    const updated = await this.sellerMappingRepo.update(mappingId, updateData);

    this.logger.log(`Mapping ${mappingId} updated by seller ${sellerId}`);

    return {
      success: true,
      message: 'Mapping updated successfully',
      data: updated,
    };
  }

  // ─── T5: Delete a mapping ─────────────────────────────────────────

  @Delete('mapping/:mappingId')
  @HttpCode(HttpStatus.OK)
  async deleteMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const sellerId = (req as any).sellerId;

    const existing = await this.sellerMappingRepo.findById(mappingId);

    if (!existing) {
      throw new NotFoundAppException('Mapping not found');
    }

    if (existing.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You do not have permission to delete this mapping',
      );
    }

    await this.sellerMappingRepo.delete(mappingId);

    this.logger.log(`Mapping ${mappingId} deleted by seller ${sellerId}`);

    return {
      success: true,
      message: 'Mapping deleted successfully',
      data: null,
    };
  }
}
