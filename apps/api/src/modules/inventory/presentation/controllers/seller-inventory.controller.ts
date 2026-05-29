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
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { InventoryManagementService } from '../../application/services/inventory-management.service';
import {
  AdjustStockDto,
  StockImportDto,
} from '../dtos/inventory-adjust.dto';

@ApiTags('Seller Inventory')
@Controller('seller/catalog')
@UseGuards(SellerAuthGuard)
export class SellerInventoryController {
  constructor(
    private readonly inventoryService: InventoryManagementService,
  ) {}

  /**
   * POST /seller/catalog/mapping/:mappingId/adjust-stock
   *
   * Phase 53 (2026-05-21) — now requires a `reason` and writes a
   * MANUAL_ADJUST StockMovement ledger row tied to the seller for
   * forensic queries. Wrapped in @Idempotent so a double-submit
   * lands once.
   */
  @Post('mapping/:mappingId/adjust-stock')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async adjustStock(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: AdjustStockDto,
  ) {
    const sellerId = (req as any).sellerId;
    const result = await this.inventoryService.adjustStock(
      mappingId,
      dto.adjustment,
      sellerId,
      {
        reason: dto.reason,
        actorId: sellerId,
        actorRole: 'SELLER',
      },
    );
    return {
      success: true,
      message: `Stock adjusted by ${dto.adjustment > 0 ? '+' : ''}${dto.adjustment}`,
      data: result,
    };
  }

  /**
   * Phase 53 (2026-05-21) — seller-facing stock movement history.
   * Lets the seller answer "how did this SKU's stock get to 50"
   * from their own dashboard instead of filing a support ticket
   * (audit Gap #12). Ownership check happens at the service layer.
   */
  @Get('mapping/:mappingId/movements')
  @HttpCode(HttpStatus.OK)
  async getMovements(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));

    const result = await this.inventoryService.getMappingMovementsForSeller(
      sellerId,
      mappingId,
      pageNum,
      limitNum,
    );
    return {
      success: true,
      message: 'Stock movement history',
      data: {
        movements: result.movements,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: result.total,
          totalPages: Math.ceil(result.total / limitNum),
        },
      },
    };
  }

  @Get('inventory-overview')
  @HttpCode(HttpStatus.OK)
  async getInventoryOverview(@Req() req: Request) {
    const sellerId = (req as any).sellerId;
    const result = await this.inventoryService.getSellerOverview(sellerId);
    return {
      success: true,
      message: 'Inventory overview retrieved',
      data: result,
    };
  }

  @Get('out-of-stock')
  @HttpCode(HttpStatus.OK)
  async getOutOfStock(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const result = await this.inventoryService.getSellerOutOfStock(
      sellerId,
      pageNum,
      limitNum,
    );

    return {
      success: true,
      message: 'Out of stock items retrieved',
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
   *
   * Phase 53 (2026-05-21) — accepts a `reason` and writes per-item
   * MANUAL_ADJUST ledger rows so the bulk-import path matches the
   * single-adjust forensic guarantee (audit Gap #7).
   */
  @Post('stock/import')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async importStock(@Req() req: Request, @Body() dto: StockImportDto) {
    const sellerId = (req as any).sellerId;
    const result = await this.inventoryService.importStockBySku(
      sellerId,
      dto.items,
      dto.reason,
      sellerId,
    );
    return {
      success: true,
      message: `Stock import complete: ${result.updated} updated, ${result.skipped.length} skipped`,
      data: result,
    };
  }
}
