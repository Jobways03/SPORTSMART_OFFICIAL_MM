import {
  Body,
  Controller,
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
} from '../../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../../core/guards';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';
import { StockSyncService } from '../../../application/services/stock-sync.service';

@ApiTags('Admin Seller Mappings')
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminSellerMappingsController {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    private readonly logger: AppLoggerService,
    private readonly stockSyncService: StockSyncService,
  ) {
    this.logger.setContext('AdminSellerMappingsController');
  }

  /**
   * GET /admin/products/:productId/seller-mappings
   * Returns all seller mappings for a specific product, sorted by operationalPriority DESC.
   */
  @Get('products/:productId/seller-mappings')
  @HttpCode(HttpStatus.OK)
  async getMappingsForProduct(
    @Param('productId') productId: string,
  ) {
    const product = await this.productRepo.findByIdBasic(productId);

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    // Auto-repair: if product has variants but only has product-level mappings
    // (variantId=null), replace them with per-variant mappings
    if (product.hasVariants) {
      await this.autoRepairStaleMappings(productId);
    }

    const mappings = await this.sellerMappingRepo.findByProduct(productId);

    const data = mappings.map((m: any) => {
      const availableQty = m.stockQty - m.reservedQty;
      let mappingDisplayStatus: string;
      if (m.approvalStatus === 'PENDING_APPROVAL') {
        mappingDisplayStatus = 'PENDING_APPROVAL';
      } else if (m.approvalStatus === 'STOPPED' || !m.isActive) {
        mappingDisplayStatus = 'INACTIVE';
      } else if (m.stockQty === 0) {
        mappingDisplayStatus = 'OUT_OF_STOCK';
      } else if (availableQty <= m.lowStockThreshold) {
        mappingDisplayStatus = 'LOW_STOCK';
      } else {
        mappingDisplayStatus = 'ACTIVE';
      }
      return {
        id: m.id,
        productId: m.productId,
        variantId: m.variantId,
        seller: m.seller,
        variant: m.variant,
        stockQty: m.stockQty,
        reservedQty: m.reservedQty,
        availableQty,
        lowStockThreshold: m.lowStockThreshold,
        mappingDisplayStatus,
        sellerInternalSku: m.sellerInternalSku,
        settlementPrice: m.settlementPrice,
        procurementCost: m.procurementCost,
        pickupAddress: m.pickupAddress,
        pickupPincode: m.pickupPincode,
        latitude: m.latitude,
        longitude: m.longitude,
        dispatchSla: m.dispatchSla,
        isActive: m.isActive,
        approvalStatus: m.approvalStatus,
        operationalPriority: m.operationalPriority,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    });

    return {
      success: true,
      message: 'Seller mappings retrieved for product',
      data: {
        product: { id: product.id, title: product.title },
        mappings: data,
        total: data.length,
      },
    };
  }

  /**
   * GET /admin/seller-mappings
   * List all seller mappings across all products with filtering, search, and pagination.
   */
  @Get('seller-mappings')
  @HttpCode(HttpStatus.OK)
  async listAllMappings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sellerId') sellerId?: string,
    @Query('productId') productId?: string,
    @Query('isActive') isActive?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '10', 10) || 10));

    const { mappings, total } = await this.sellerMappingRepo.findAllPaginated({
      page: pageNum,
      limit: limitNum,
      sellerId,
      productId,
      isActive: isActive !== undefined && isActive !== '' ? isActive === 'true' : undefined,
      approvalStatus,
      search,
    });

    const enrichedMappings = mappings.map((m: any) => {
      const availableQty = m.stockQty - m.reservedQty;
      let mappingDisplayStatus: string;
      if (m.approvalStatus === 'PENDING_APPROVAL') {
        mappingDisplayStatus = 'PENDING_APPROVAL';
      } else if (m.approvalStatus === 'STOPPED' || !m.isActive) {
        mappingDisplayStatus = 'INACTIVE';
      } else if (m.stockQty === 0) {
        mappingDisplayStatus = 'OUT_OF_STOCK';
      } else if (availableQty <= m.lowStockThreshold) {
        mappingDisplayStatus = 'LOW_STOCK';
      } else {
        mappingDisplayStatus = 'ACTIVE';
      }
      return {
        ...m,
        availableQty,
        mappingDisplayStatus,
      };
    });

    return {
      success: true,
      message: 'Seller mappings retrieved successfully',
      data: {
        mappings: enrichedMappings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  // ─── A5: Pending mappings (must be before parameterized :mappingId routes) ──

  /**
   * GET /admin/seller-mappings/pending
   * List all PENDING_APPROVAL mappings (for dashboard badge).
   */
  @Get('seller-mappings/pending')
  @HttpCode(HttpStatus.OK)
  async listPendingMappings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const { mappings, total } = await this.sellerMappingRepo.findPendingPaginated(pageNum, limitNum);

    return {
      success: true,
      message: 'Pending approval mappings retrieved',
      data: {
        mappings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  /**
   * PATCH /admin/seller-mappings/:mappingId
   * Admin can override any mapping field (stock, SLA, priority, isActive, settlement price, etc.)
   */
  @Patch('seller-mappings/:mappingId')
  @HttpCode(HttpStatus.OK)
  async updateMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() body: any,
  ) {
    const adminId = (req as any).adminId;

    const existing = await this.sellerMappingRepo.findById(mappingId);

    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }

    const updateData: any = {};

    // Inventory fields
    if (body.stockQty !== undefined) {
      if (typeof body.stockQty !== 'number' || body.stockQty < 0) {
        throw new BadRequestAppException('stockQty must be a non-negative number');
      }
      updateData.stockQty = body.stockQty;
    }

    if (body.reservedQty !== undefined) {
      if (typeof body.reservedQty !== 'number' || body.reservedQty < 0) {
        throw new BadRequestAppException('reservedQty must be a non-negative number');
      }
      updateData.reservedQty = body.reservedQty;
    }

    // Seller internal SKU
    if (body.sellerInternalSku !== undefined) {
      updateData.sellerInternalSku = body.sellerInternalSku;
    }

    // Pricing fields
    if (body.settlementPrice !== undefined) {
      if (body.settlementPrice !== null && (typeof body.settlementPrice !== 'number' || body.settlementPrice < 0)) {
        throw new BadRequestAppException('settlementPrice must be a non-negative number or null');
      }
      updateData.settlementPrice = body.settlementPrice;
    }

    if (body.procurementCost !== undefined) {
      if (body.procurementCost !== null && (typeof body.procurementCost !== 'number' || body.procurementCost < 0)) {
        throw new BadRequestAppException('procurementCost must be a non-negative number or null');
      }
      updateData.procurementCost = body.procurementCost;
    }

    // Fulfillment fields
    if (body.pickupAddress !== undefined) {
      updateData.pickupAddress = body.pickupAddress;
    }

    if (body.pickupPincode !== undefined) {
      updateData.pickupPincode = body.pickupPincode;
    }

    if (body.latitude !== undefined) {
      updateData.latitude = body.latitude;
    }

    if (body.longitude !== undefined) {
      updateData.longitude = body.longitude;
    }

    if (body.dispatchSla !== undefined) {
      if (typeof body.dispatchSla !== 'number' || body.dispatchSla < 0) {
        throw new BadRequestAppException('dispatchSla must be a non-negative number');
      }
      updateData.dispatchSla = body.dispatchSla;
    }

    // Status & priority
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        throw new BadRequestAppException('isActive must be a boolean');
      }
      updateData.isActive = body.isActive;
    }

    if (body.operationalPriority !== undefined) {
      if (typeof body.operationalPriority !== 'number') {
        throw new BadRequestAppException('operationalPriority must be a number');
      }
      updateData.operationalPriority = body.operationalPriority;
    }

    if (body.lowStockThreshold !== undefined) {
      if (typeof body.lowStockThreshold !== 'number' || body.lowStockThreshold < 0) {
        throw new BadRequestAppException('lowStockThreshold must be a non-negative number');
      }
      updateData.lowStockThreshold = body.lowStockThreshold;
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestAppException('No valid fields provided for update');
    }

    const updated = await this.sellerMappingRepo.update(mappingId, updateData);

    // Sync variant stock from all mappings when mapping stockQty changes
    if (body.stockQty !== undefined) {
      await this.stockSyncService.syncVariantStockFromMappings(
        existing.productId, existing.variantId,
      );
    }

    this.logger.log(
      `Seller mapping ${mappingId} updated by admin ${adminId}: ${JSON.stringify(updateData)}`,
    );

    return {
      success: true,
      message: 'Seller mapping updated successfully',
      data: updated,
    };
  }

  // ─── A5: Approval & stop endpoints ──────────────────────────────────

  /**
   * POST /admin/seller-mappings/:mappingId/approve
   * Approves a seller mapping — sets approvalStatus to APPROVED and isActive to true.
   */
  @Post('seller-mappings/:mappingId/approve')
  @HttpCode(HttpStatus.OK)
  async approveMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const adminId = (req as any).adminId;

    const existing = await this.sellerMappingRepo.findById(mappingId);

    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }

    const updated = await this.sellerMappingRepo.approve(mappingId);

    this.logger.log(
      `Seller mapping ${mappingId} APPROVED by admin ${adminId}`,
    );

    return {
      success: true,
      message: 'Seller mapping approved successfully',
      data: updated,
    };
  }

  /**
   * POST /admin/seller-mappings/:mappingId/stop
   * Stops a seller mapping — sets approvalStatus to STOPPED and isActive to false.
   */
  @Post('seller-mappings/:mappingId/stop')
  @HttpCode(HttpStatus.OK)
  async stopMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const adminId = (req as any).adminId;

    const existing = await this.sellerMappingRepo.findById(mappingId);

    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }

    const updated = await this.sellerMappingRepo.stop(mappingId);

    this.logger.log(
      `Seller mapping ${mappingId} STOPPED by admin ${adminId}`,
    );

    return {
      success: true,
      message: 'Seller mapping stopped successfully',
      data: updated,
    };
  }

  /**
   * Auto-repair: if a product has variants but only product-level mappings
   * (variantId=null), replace them with per-variant mappings.
   */
  private async autoRepairStaleMappings(productId: string): Promise<void> {
    try {
      const mappings = await this.sellerMappingRepo.findByProduct(productId);
      // Find stale product-level mappings (variantId is null)
      const staleMappings = mappings.filter((m: any) => m.variantId === null);
      if (staleMappings.length === 0) return;

      // Get the product with its variants
      const fullProduct = await this.productRepo.findFullProduct(productId);
      const variants = fullProduct?.variants || [];
      if (variants.length === 0) return; // No variants to map to

      for (const staleMapping of staleMappings) {
        const sellerId = staleMapping.sellerId;

        // Check if per-variant mappings already exist for this seller
        const existingForSeller = await this.sellerMappingRepo.findBySellerForProduct(sellerId, productId);
        const existingVariantIds = new Set(existingForSeller.map((m: any) => m.variantId).filter(Boolean));

        // Only repair if this seller has no per-variant mappings yet
        if (existingVariantIds.size > 0) continue;

        const sellerProfile = await this.productRepo.findSellerById(sellerId);

        // Create per-variant mappings
        for (const variant of variants) {
          await this.sellerMappingRepo.create({
            sellerId,
            productId,
            variantId: variant.id,
            stockQty: variant.stock ?? 0,
            settlementPrice: variant.price
              ? Number(variant.price)
              : fullProduct?.basePrice
                ? Number(fullProduct.basePrice)
                : undefined,
            pickupAddress: staleMapping.pickupAddress || sellerProfile?.storeAddress || null,
            pickupPincode: staleMapping.pickupPincode || sellerProfile?.sellerZipCode || null,
            dispatchSla: staleMapping.dispatchSla || 2,
            approvalStatus: staleMapping.approvalStatus || 'APPROVED',
            isActive: staleMapping.isActive ?? true,
          });
        }

        // Remove the stale product-level mapping
        await this.sellerMappingRepo.delete(staleMapping.id);

        this.logger.log(
          `Auto-repaired stale product-level mapping for product ${productId}, seller ${sellerId}: replaced with ${variants.length} variant mapping(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to auto-repair stale mappings for product ${productId}: ${err}`);
    }
  }
}
