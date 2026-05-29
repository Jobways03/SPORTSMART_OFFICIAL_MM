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
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../core/guards';
import { Permissions } from '../../core/decorators/permissions.decorator';
import {
  CreateFlashSaleInput,
  MarketingService,
  UpdateFlashSaleInput,
} from './marketing.service';

// Marketing-team admin CRUD for flash-sale campaigns. Reuses the
// existing `content.*` permission set since flash sales are marketing
// content and the team that manages them already has those perms.
@ApiTags('Admin Flash Sales')
@Controller('admin/flash-sales')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminFlashSalesController {
  constructor(private readonly service: MarketingService) {}

  @Get()
  @Permissions('content.read')
  async list(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.service.adminListFlashSales({
      page: pageNum,
      limit: limitNum,
    });
    return { success: true, message: 'Flash sales', data };
  }

  @Get(':id')
  @Permissions('content.read')
  async getOne(@Param('id') id: string) {
    const sale = await this.service.adminGetFlashSale(id);
    return { success: true, message: 'Flash sale', data: sale };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('content.write')
  async create(@Body() body: CreateFlashSaleInput) {
    const sale = await this.service.createFlashSale(body);
    return { success: true, message: 'Flash sale created', data: sale };
  }

  @Patch(':id')
  @Permissions('content.write')
  async update(@Param('id') id: string, @Body() body: UpdateFlashSaleInput) {
    const sale = await this.service.updateFlashSale(id, body);
    return { success: true, message: 'Flash sale updated', data: sale };
  }

  @Delete(':id')
  @Permissions('content.write')
  async remove(@Param('id') id: string) {
    await this.service.deleteFlashSale(id);
    return { success: true, message: 'Flash sale deleted' };
  }
}
