import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { FranchiseOrdersService } from '../../application/services/franchise-orders.service';

@ApiTags('Admin Franchise Orders')
@Controller('admin/franchise-orders')
@UseGuards(AdminAuthGuard)
export class AdminFranchiseOrdersController {
  constructor(
    private readonly franchiseOrdersService: FranchiseOrdersService,
  ) {}

  @Get('franchises/:franchiseId')
  async listFranchiseOrders(
    @Param('franchiseId') franchiseId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('acceptStatus') acceptStatus?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.franchiseOrdersService.listOrders(
      franchiseId,
      Math.max(1, parseInt(page || '1', 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
      { fulfillmentStatus, acceptStatus, search },
    );
    return { success: true, message: 'Franchise orders retrieved', data };
  }

  @Get('franchises/:franchiseId/stale')
  async listStaleFranchiseOrders(@Param('franchiseId') franchiseId: string) {
    const data = await this.franchiseOrdersService.findStaleAcceptedOrders(franchiseId);
    return {
      success: true,
      message: 'Stale franchise orders retrieved',
      data,
    };
  }

  @Patch(':subOrderId/mark-delivered')
  async markDelivered(@Param('subOrderId') subOrderId: string) {
    const data = await this.franchiseOrdersService.markDelivered(subOrderId);
    return {
      success: true,
      message: 'Franchise order marked as delivered',
      data,
    };
  }
}
