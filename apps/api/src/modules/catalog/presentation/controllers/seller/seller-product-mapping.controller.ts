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
  ForbiddenAppException,
  ConflictAppException,
} from '../../../../../core/exceptions';
import { SellerAuthGuard } from '../../../../../core/guards';

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
    private readonly prisma: PrismaService,
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

    // Get product IDs that this seller has already mapped to
    const existingMappings = await this.prisma.sellerProductMapping.findMany({
      where: { sellerId },
      select: { productId: true },
      distinct: ['productId'],
    });
    const mappedProductIds = existingMappings.map((m) => m.productId);

    // Build where clause: ACTIVE + APPROVED products not yet mapped
    const where: any = {
      status: 'ACTIVE',
      moderationStatus: 'APPROVED',
      isDeleted: false,
    };

    if (mappedProductIds.length > 0) {
      where.id = { notIn: mappedProductIds };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { productCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (brandId) {
      where.brandId = brandId;
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          _count: { select: { variants: { where: { isDeleted: false } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.product.count({ where }),
    ]);

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
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: {
        variants: {
          where: { isDeleted: false },
          select: { id: true },
        },
      },
    });

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
      const variant = await this.prisma.productVariant.findFirst({
        where: {
          id: dto.variantId,
          productId: dto.productId,
          isDeleted: false,
        },
      });
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
      const postOffice = await this.prisma.postOffice.findFirst({
        where: { pincode: dto.pickupPincode, latitude: { not: null } },
        select: { latitude: true, longitude: true },
      });
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
      const existingMappings = await this.prisma.sellerProductMapping.findMany({
        where: { sellerId, productId: dto.productId },
        select: { variantId: true },
      });
      const existingVariantIds = new Set(
        existingMappings.map((m) => m.variantId),
      );

      const variantsToMap = product.variants.filter(
        (v) => !existingVariantIds.has(v.id),
      );

      if (variantsToMap.length === 0) {
        throw new ConflictAppException(
          'You have already mapped all variants of this product',
        );
      }

      const createdMappings = await this.prisma.$transaction(async (tx) => {
        const results = [];
        for (const variant of variantsToMap) {
          const mapping = await tx.sellerProductMapping.create({
            data: {
              ...baseMappingData,
              variantId: variant.id,
            },
            include: {
              product: {
                select: { id: true, title: true, productCode: true },
              },
              variant: {
                select: { id: true, sku: true, price: true },
              },
            },
          });
          results.push(mapping);
        }
        return results;
      });

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
      const existing = await this.prisma.sellerProductMapping.findFirst({
        where: {
          sellerId,
          productId: dto.productId,
          variantId,
        },
      });

      if (existing) {
        throw new ConflictAppException(
          'You have already mapped to this product' +
            (variantId ? ' variant' : ''),
        );
      }

      const mapping = await this.prisma.sellerProductMapping.create({
        data: {
          ...baseMappingData,
          variantId,
        },
        include: {
          product: {
            select: { id: true, title: true, productCode: true },
          },
          variant: {
            select: { id: true, sku: true, price: true },
          },
        },
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

    // Find products that have at least one mapping for this seller
    const productWhere: any = {
      sellerMappings: {
        some: { sellerId },
      },
      isDeleted: false,
    };

    if (search) {
      productWhere.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { productCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: productWhere,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          sellerMappings: {
            where: { sellerId },
            include: {
              variant: {
                select: {
                  id: true,
                  sku: true,
                  price: true,
                  compareAtPrice: true,
                  optionValues: {
                    include: {
                      optionValue: {
                        include: { optionDefinition: true },
                      },
                    },
                  },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { title: 'asc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.product.count({ where: productWhere }),
    ]);

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
  // NOTE: This must be declared BEFORE the parameterized :mappingId routes
  // to prevent NestJS from matching "bulk-stock" as a mappingId param.

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
    const existingMappings = await this.prisma.sellerProductMapping.findMany({
      where: {
        id: { in: mappingIds },
      },
      select: { id: true, sellerId: true },
    });

    const existingMap = new Map(existingMappings.map((m) => [m.id, m]));

    for (const mappingId of mappingIds) {
      const mapping = existingMap.get(mappingId);
      if (!mapping) {
        throw new NotFoundAppException(`Mapping ${mappingId} not found`);
      }
      if (mapping.sellerId !== sellerId) {
        throw new ForbiddenAppException(
          `You do not have permission to update mapping ${mappingId}`,
        );
      }
    }

    // Perform bulk update in transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const update of dto.updates) {
        const result = await tx.sellerProductMapping.update({
          where: { id: update.mappingId },
          data: { stockQty: update.stockQty },
          select: {
            id: true,
            stockQty: true,
            variantId: true,
            productId: true,
          },
        });
        results.push(result);
      }
      return results;
    });

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

    const existing = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
    });

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

    const updated = await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: updateData,
      include: {
        product: {
          select: { id: true, title: true, productCode: true },
        },
        variant: {
          select: { id: true, sku: true, price: true },
        },
      },
    });

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

    const existing = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
    });

    if (!existing) {
      throw new NotFoundAppException('Mapping not found');
    }

    if (existing.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You do not have permission to delete this mapping',
      );
    }

    await this.prisma.sellerProductMapping.delete({
      where: { id: mappingId },
    });

    this.logger.log(`Mapping ${mappingId} deleted by seller ${sellerId}`);

    return {
      success: true,
      message: 'Mapping deleted successfully',
      data: null,
    };
  }
}
