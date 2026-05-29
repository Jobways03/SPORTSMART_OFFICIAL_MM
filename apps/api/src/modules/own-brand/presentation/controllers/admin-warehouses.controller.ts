import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { OwnBrandService } from '../../application/services/own-brand.service';
import {
  AdjustStockDto,
  CreateWarehouseDto,
  TransferStockDto,
  UpdateWarehouseDto,
} from '../dtos/own-brand.dtos';
import { Permissions } from '../../../../core/decorators/permissions.decorator';

@ApiTags('NOVA — Warehouses & Stock')
@Controller('admin/nova')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('nova.write')
export class AdminNovaWarehousesController {
  constructor(private readonly service: OwnBrandService) {}

  // ── Warehouses ─────────────────────────────────────────────────

  @Get('warehouses')
  async listWarehouses(@Query('activeOnly') activeOnly?: string) {
    const data = await this.service.listWarehouses(activeOnly === 'true');
    return { success: true, message: 'Warehouses retrieved', data };
  }

  @Post('warehouses')
  async createWarehouse(@Body() body: CreateWarehouseDto) {
    const data = await this.service.createWarehouse(body);
    return { success: true, message: 'Warehouse created', data };
  }

  @Patch('warehouses/:id')
  async updateWarehouse(
    @Param('id') id: string,
    @Body() body: UpdateWarehouseDto,
  ) {
    const data = await this.service.updateWarehouse(id, body);
    return { success: true, message: 'Warehouse updated', data };
  }

  @Delete('warehouses/:id')
  async deactivateWarehouse(@Param('id') id: string) {
    const data = await this.service.updateWarehouse(id, { isActive: false });
    return { success: true, message: 'Warehouse deactivated', data };
  }

  // ── Stocks ─────────────────────────────────────────────────────

  @Get('stocks')
  async listStocks(
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
  ) {
    const data = await this.service.listStocks({
      warehouseId,
      productId,
      lowStockOnly: lowStockOnly === 'true',
    });
    return { success: true, message: 'Stocks retrieved', data };
  }

  @Post('stocks/adjust')
  async adjustStock(@Req() req: any, @Body() body: AdjustStockDto) {
    const data = await this.service.adjustStock({
      warehouseId: body.warehouseId,
      productId: body.productId,
      variantId: body.variantId ?? null,
      delta: Number(body.delta),
      reason: body.reason,
      adminId: req.adminId,
    });
    return { success: true, message: 'Stock adjusted', data };
  }

  @Get('stocks/movements')
  async listMovements(
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('variantId') variantId?: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.listStockMovements({
      warehouseId,
      productId,
      variantId: variantId === undefined ? undefined : variantId || null,
      kind: kind ? (kind as any) : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return { success: true, message: 'Stock movements retrieved', data };
  }

  // Story 3.4 — atomic stock transfer between two Nova warehouses.
  // Single tx writes both legs of the movement ledger so partial
  // failures can't leave stock floating.
  @Post('stocks/transfer')
  @Permissions('nova.stock')
  async transferStock(@Req() req: any, @Body() body: TransferStockDto) {
    const data = await this.service.transferStock({
      fromWarehouseId: body.fromWarehouseId,
      toWarehouseId: body.toWarehouseId,
      productId: body.productId,
      variantId: body.variantId ?? null,
      quantity: Number(body.quantity),
      reason: body.reason,
      adminId: req.adminId,
    });
    return { success: true, message: 'Stock transferred', data };
  }
}
