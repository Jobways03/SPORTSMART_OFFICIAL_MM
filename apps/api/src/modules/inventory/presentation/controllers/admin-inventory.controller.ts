import {
  Body,
  Controller,
  ForbiddenException,
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
import { StockMovementKind } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { InventoryManagementService } from '../../application/services/inventory-management.service';
import { AdminAdjustStockDto } from '../dtos/inventory-adjust.dto';

@ApiTags('Admin Inventory')
@Controller('admin/inventory')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('nova.read')
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
   * GET /admin/inventory/all
   * Unified, paginated, filterable inventory grid across seller
   * mappings + franchise stock. Powers the redesigned admin
   * Inventory page so the user can browse "all stock", not just
   * low / out-of-stock items.
   */
  @Get('all')
  @HttpCode(HttpStatus.OK)
  async getAllInventory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sellerId') sellerId?: string,
    @Query('nodeType') nodeType?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const validNode =
      nodeType === 'SELLER' || nodeType === 'FRANCHISE' || nodeType === 'ALL'
        ? (nodeType as 'SELLER' | 'FRANCHISE' | 'ALL')
        : 'ALL';

    const validStatus =
      status === 'HEALTHY' || status === 'LOW' || status === 'OUT' ||
      status === 'INACTIVE' || status === 'ALL'
        ? (status as 'HEALTHY' | 'LOW' | 'OUT' | 'INACTIVE' | 'ALL')
        : 'ALL';

    const result = await this.inventoryService.getAdminAllInventory({
      page: pageNum,
      limit: limitNum,
      search,
      sellerId,
      nodeType: validNode,
      status: validStatus,
    });

    return {
      success: true,
      message: 'Inventory retrieved',
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
   * GET /admin/inventory/mappings/:mappingId/movements
   * Stock movement audit trail for a single seller mapping. Used
   * by the admin inventory drill-down to show what happened to a
   * SKU's stock over time.
   */
  @Get('mappings/:mappingId/movements')
  @HttpCode(HttpStatus.OK)
  async getMappingMovements(
    @Param('mappingId') mappingId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));

    const result = await this.inventoryService.getMappingMovements(
      mappingId,
      pageNum,
      limitNum,
    );

    return {
      success: true,
      message: 'Stock movements retrieved',
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
    @Query('nodeType') nodeType?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const validNode =
      nodeType === 'SELLER' || nodeType === 'FRANCHISE' || nodeType === 'ALL'
        ? (nodeType as 'SELLER' | 'FRANCHISE' | 'ALL')
        : undefined;

    const result = await this.inventoryService.getAdminLowStock(
      pageNum,
      limitNum,
      sellerId,
      validNode,
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
    @Query('nodeType') nodeType?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const validNode =
      nodeType === 'SELLER' || nodeType === 'FRANCHISE' || nodeType === 'ALL'
        ? (nodeType as 'SELLER' | 'FRANCHISE' | 'ALL')
        : undefined;

    const result = await this.inventoryService.getOutOfStockProducts(
      pageNum,
      limitNum,
      validNode,
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
   * POST /admin/inventory/mappings/:mappingId/adjust-stock
   *
   * Phase 53 (2026-05-21) — admin-driven stock adjustment. Pre-Phase-53
   * the admin had NO API to correct seller inventory (audit Gap #3).
   * Now: requires inventory.adjust permission, mandatory reason,
   * optional kind selector. WRITE_OFF kind additionally requires
   * inventory.adjust.write_off (higher-tier signoff).
   *
   * The service runs the change inside a SELECT FOR UPDATE
   * transaction with the floor check + ledger write, so admin
   * adjustments are race-safe and forensically traceable.
   */
  @Post('mappings/:mappingId/adjust-stock')
  @HttpCode(HttpStatus.OK)
  @Permissions('inventory.adjust')
  @Idempotent()
  async adjustMappingStock(
    @Param('mappingId') mappingId: string,
    @Body() dto: AdminAdjustStockDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const adminPerms = ((req as any).adminPermissions ?? []) as string[];

    if (
      dto.kind === StockMovementKind.WRITE_OFF &&
      !adminPerms.includes('inventory.adjust.write_off')
    ) {
      throw new ForbiddenException(
        'inventory.adjust.write_off permission required for WRITE_OFF kind',
      );
    }

    const result = await this.inventoryService.adjustForAdmin(
      mappingId,
      dto.adjustment,
      dto.reason,
      adminId ?? 'unknown-admin',
      dto.kind,
    );
    return {
      success: true,
      message: `Stock adjusted by ${dto.adjustment > 0 ? '+' : ''}${dto.adjustment}`,
      data: result,
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
