import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { InventoryManagementService } from '../../application/services/inventory-management.service';
import { BadRequestAppException } from '../../../../core/exceptions';

// ─── DTOs ────────────────────────────────────────────────────────────────

interface AdjustStockDto {
  adjustment: number;
}

interface StockImportDto {
  items: { masterSku: string; stockQty: number }[];
}

// ─── Controller ──────────────────────────────────────────────────────────

@ApiTags('Seller Inventory')
@Controller('seller/catalog')
@UseGuards(SellerAuthGuard)
export class SellerInventoryController {
  constructor(
    private readonly inventoryService: InventoryManagementService,
  ) {}

  /**
   * POST /seller/catalog/mapping/:mappingId/adjust-stock
   * Manual stock adjustment by seller (positive = add, negative = remove).
   */
  @Post('mapping/:mappingId/adjust-stock')
  @HttpCode(HttpStatus.OK)
  async adjustStock(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: AdjustStockDto,
  ) {
    const sellerId = (req as any).sellerId;

    if (dto.adjustment === undefined || dto.adjustment === null) {
      throw new BadRequestAppException('adjustment is required');
    }
    if (typeof dto.adjustment !== 'number') {
      throw new BadRequestAppException('adjustment must be a number');
    }

    const result = await this.inventoryService.adjustStock(
      mappingId,
      dto.adjustment,
      sellerId,
    );

    return {
      success: true,
      message: `Stock adjusted by ${dto.adjustment > 0 ? '+' : ''}${dto.adjustment}`,
      data: result,
    };
  }

  /**
   * GET /seller/catalog/low-stock
   * Returns mappings where available stock <= lowStockThreshold.
   */
  @Get('low-stock')
  @HttpCode(HttpStatus.OK)
  async getLowStock(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const result = await this.inventoryService.getSellerLowStock(
      sellerId,
      pageNum,
      limitNum,
    );

    return {
      success: true,
      message: 'Low stock items retrieved',
      data: {
        items: result.items,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: result.total,
          totalPages: Math.ceil(result.total / limitNum),
        },
      },
    };
  }

  /**
   * POST /seller/catalog/stock/import
   * Bulk stock update via masterSku lookup.
   * Body: { items: [{ masterSku: "PRD-000001-BLU-8", stockQty: 50 }] }
   */
  @Post('stock/import')
  @HttpCode(HttpStatus.OK)
  async importStock(
    @Req() req: Request,
    @Body() dto: StockImportDto,
  ) {
    const sellerId = (req as any).sellerId;

    if (!dto.items || !Array.isArray(dto.items)) {
      throw new BadRequestAppException('items array is required');
    }

    const result = await this.inventoryService.importStockBySku(
      sellerId,
      dto.items,
    );

    return {
      success: true,
      message: `Stock import complete: ${result.updated} updated, ${result.skipped.length} skipped`,
      data: result,
    };
  }
}
