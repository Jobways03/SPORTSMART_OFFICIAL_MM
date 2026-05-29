import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { LowStockAlertService } from '../../application/services/low-stock-alert.service';

@ApiTags('Admin Inventory — Low-stock alerts')
@Controller('admin/inventory/alerts')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('nova.read')
export class AdminLowStockAlertsController {
  constructor(private readonly service: LowStockAlertService) {}

  @Get()
  async list(@Query('sellerId') sellerId?: string, @Query('limit') limit?: string) {
    const data = await this.service.listOpen({
      sellerId,
      limit: limit ? parseInt(limit, 10) : 200,
    });
    return { success: true, message: 'Open low-stock alerts', data };
  }

  /** Trigger a sweep on demand. Cron does this automatically (Phase F3). */
  @Post('sweep')
  async sweep() {
    const data = await this.service.sweep();
    return { success: true, message: 'Sweep complete', data };
  }
}
