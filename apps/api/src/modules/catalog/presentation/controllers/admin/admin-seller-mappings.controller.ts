import {
  Body,
  Controller,
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
import { AdminAuthGuard } from '../../../../../core/guards';

@ApiTags('Admin Seller Mappings')
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminSellerMappingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
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
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      select: { id: true, title: true },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    const mappings = await this.prisma.sellerProductMapping.findMany({
      where: { productId },
      include: {
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            email: true,
            status: true,
            storeAddress: true,
            sellerZipCode: true,
          },
        },
        variant: {
          select: {
            id: true,
            masterSku: true,
            title: true,
            sku: true,
          },
        },
      },
      orderBy: { operationalPriority: 'desc' },
    });

    const data = mappings.map((m) => {
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

    const where: any = {};

    if (sellerId) {
      where.sellerId = sellerId;
    }

    if (productId) {
      where.productId = productId;
    }

    if (isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true';
    }

    if (approvalStatus) {
      where.approvalStatus = approvalStatus;
    }

    if (search) {
      where.OR = [
        {
          product: {
            title: { contains: search, mode: 'insensitive' },
          },
        },
        {
          seller: {
            sellerName: { contains: search, mode: 'insensitive' },
          },
        },
        {
          seller: {
            sellerShopName: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [mappings, total] = await Promise.all([
      this.prisma.sellerProductMapping.findMany({
        where,
        include: {
          seller: {
            select: {
              id: true,
              sellerName: true,
              sellerShopName: true,
              email: true,
              status: true,
              storeAddress: true,
              sellerZipCode: true,
            },
          },
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              productCode: true,
              status: true,
            },
          },
          variant: {
            select: {
              id: true,
              masterSku: true,
              title: true,
              sku: true,
            },
          },
        },
        orderBy: [
          { operationalPriority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.sellerProductMapping.count({ where }),
    ]);

    const enrichedMappings = mappings.map((m) => {
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

    const where = { approvalStatus: 'PENDING_APPROVAL' as const };

    const [mappings, total] = await Promise.all([
      this.prisma.sellerProductMapping.findMany({
        where,
        include: {
          seller: {
            select: {
              id: true,
              sellerName: true,
              sellerShopName: true,
              email: true,
              status: true,
            },
          },
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              productCode: true,
              status: true,
            },
          },
          variant: {
            select: {
              id: true,
              masterSku: true,
              title: true,
              sku: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.sellerProductMapping.count({ where }),
    ]);

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

    const existing = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
    });

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

    const updated = await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: updateData,
      include: {
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            email: true,
          },
        },
        product: {
          select: {
            id: true,
            title: true,
            slug: true,
            productCode: true,
          },
        },
        variant: {
          select: {
            id: true,
            masterSku: true,
            title: true,
            sku: true,
          },
        },
      },
    });

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

    const existing = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
    });

    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }

    const updated = await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: {
        approvalStatus: 'APPROVED',
        isActive: true,
      },
      include: {
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            email: true,
          },
        },
        product: {
          select: {
            id: true,
            title: true,
            slug: true,
            productCode: true,
          },
        },
        variant: {
          select: {
            id: true,
            masterSku: true,
            title: true,
            sku: true,
          },
        },
      },
    });

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

    const existing = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
    });

    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }

    const updated = await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: {
        approvalStatus: 'STOPPED',
        isActive: false,
      },
      include: {
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            email: true,
          },
        },
        product: {
          select: {
            id: true,
            title: true,
            slug: true,
            productCode: true,
          },
        },
        variant: {
          select: {
            id: true,
            masterSku: true,
            title: true,
            sku: true,
          },
        },
      },
    });

    this.logger.log(
      `Seller mapping ${mappingId} STOPPED by admin ${adminId}`,
    );

    return {
      success: true,
      message: 'Seller mapping stopped successfully',
      data: updated,
    };
  }
}
