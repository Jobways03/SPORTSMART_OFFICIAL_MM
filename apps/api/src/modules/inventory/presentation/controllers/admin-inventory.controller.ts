import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { InventoryManagementService } from '../../application/services/inventory-management.service';

@ApiTags('Admin Inventory')
@Controller('admin/inventory')
@UseGuards(AdminAuthGuard)
export class AdminInventoryController {
  constructor(
    private readonly inventoryService: InventoryManagementService,
  ) {}

  /**
   * GET /admin/inventory/overview
   * Returns aggregate inventory statistics.
   */
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  async getOverview() {
    const overview = await this.inventoryService.getInventoryOverview();

    return {
      success: true,
      message: 'Inventory overview retrieved',
      data: overview,
    };
  }

  /**
   * GET /admin/inventory/low-stock
   * Returns all low-stock mappings across all sellers.
   */
  @Get('low-stock')
  @HttpCode(HttpStatus.OK)
  async getLowStock(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const result = await this.inventoryService.getAdminLowStock(
      pageNum,
      limitNum,
      sellerId,
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
   * GET /admin/inventory/out-of-stock
   * Returns products/variants where total aggregated stock across all sellers = 0.
   */
  @Get('out-of-stock')
  @HttpCode(HttpStatus.OK)
  async getOutOfStock(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const result = await this.inventoryService.getOutOfStockProducts(
      pageNum,
      limitNum,
    );

    return {
      success: true,
      message: 'Out of stock products retrieved',
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
   * GET /admin/inventory/reservations
   * Lists active stock reservations (status=RESERVED) for monitoring.
   */
  @Get('reservations')
  @HttpCode(HttpStatus.OK)
  async getActiveReservations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('mappingId') mappingId?: string,
    @Query('orderId') orderId?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const result = await this.inventoryService.getActiveReservations(
      pageNum,
      limitNum,
      { mappingId, orderId },
    );

    return {
      success: true,
      message: 'Active reservations retrieved',
      data: {
        reservations: result.reservations,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: result.total,
          totalPages: Math.ceil(result.total / limitNum),
        },
      },
    };
  }
}
