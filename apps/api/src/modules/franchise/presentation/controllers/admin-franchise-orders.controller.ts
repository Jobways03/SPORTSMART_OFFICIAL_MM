import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { FranchiseOrdersService } from '../../application/services/franchise-orders.service';

@ApiTags('Admin Franchise Orders')
@Controller('admin/franchise-orders')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('franchise.orders')
export class AdminFranchiseOrdersController {
  constructor(
    private readonly franchiseOrdersService: FranchiseOrdersService,
  ) {}

  // Global count across ALL franchises — powers the franchise-admin sidebar
  // "Orders" badge (e.g. acceptStatus=OPEN = new orders awaiting acceptance).
  @Get('count')
  async countOrders(@Query('acceptStatus') acceptStatus?: string) {
    const data = await this.franchiseOrdersService.countOrders({ acceptStatus });
    return { success: true, message: 'Franchise order count', data };
  }

  // Global, filterable list across ALL franchises — the franchise-admin flat
  // Orders table (parity with the seller-admin orders page).
  @Get()
  async listAllFranchiseOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('orderStatus') orderStatus?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('acceptStatus') acceptStatus?: string,
  ) {
    const data = await this.franchiseOrdersService.listAllOrders(
      Math.max(1, parseInt(page || '1', 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
      { search, orderStatus, paymentStatus, fulfillmentStatus, acceptStatus },
    );
    return { success: true, message: 'Franchise orders retrieved', data };
  }

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

  @Get('sub-orders/:subOrderId')
  async getFranchiseOrder(@Param('subOrderId') subOrderId: string) {
    const data =
      await this.franchiseOrdersService.getOrderForAdmin(subOrderId);
    return { success: true, message: 'Franchise order retrieved', data };
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
