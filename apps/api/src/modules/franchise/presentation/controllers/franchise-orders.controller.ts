import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { FranchiseOrdersService } from '../../application/services/franchise-orders.service';
import { BadRequestAppException } from '../../../../core/exceptions';

@ApiTags('Franchise Orders')
@Controller('franchise/orders')
@UseGuards(FranchiseAuthGuard)
export class FranchiseOrdersController {
  constructor(
    private readonly franchiseOrdersService: FranchiseOrdersService,
  ) {}

  @Get()
  async listOrders(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('acceptStatus') acceptStatus?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.franchiseOrdersService.listOrders(
      req.franchiseId,
      Math.max(1, parseInt(page || '1', 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
      { fulfillmentStatus, acceptStatus, search },
    );
    return { success: true, message: 'Orders retrieved', data };
  }

  @Get(':subOrderId')
  async getOrder(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
  ) {
    const data = await this.franchiseOrdersService.getOrder(
      subOrderId,
      req.franchiseId,
    );
    return { success: true, message: 'Order retrieved', data };
  }

  @Patch(':subOrderId/accept')
  async acceptOrder(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: { expectedDispatchDate?: string },
  ) {
    const data = await this.franchiseOrdersService.acceptOrder(
      subOrderId,
      req.franchiseId,
      { expectedDispatchDate: body?.expectedDispatchDate },
    );
    return { success: true, message: 'Order accepted', data };
  }

  @Patch(':subOrderId/reject')
  async rejectOrder(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body()
    body: {
      reason?: 'OUT_OF_STOCK' | 'CANNOT_SHIP' | 'LOCATION_ISSUE' | 'OTHER';
      note?: string;
    },
  ) {
    const data = await this.franchiseOrdersService.rejectOrder(
      subOrderId,
      req.franchiseId,
      { reason: body?.reason, note: body?.note },
    );
    return { success: true, message: data.message, data };
  }

  @Patch(':subOrderId/status')
  async updateFulfillmentStatus(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: { status: string; trackingNumber?: string; courierName?: string },
  ) {
    if (!body.status) {
      throw new BadRequestAppException(
        'status is required (PACKED, SHIPPED)',
      );
    }
    const data = await this.franchiseOrdersService.updateFulfillmentStatus(
      subOrderId,
      req.franchiseId,
      body.status.toUpperCase(),
      { trackingNumber: body.trackingNumber, courierName: body.courierName },
    );
    return {
      success: true,
      message: `Order status updated to ${body.status.toUpperCase()}`,
      data,
    };
  }

  @Post(':subOrderId/return')
  async initiateReturn(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body()
    body: {
      items: Array<{ orderItemId: string; quantity: number; reason: string }>;
    },
  ) {
    const data = await this.franchiseOrdersService.initiateReturn(subOrderId, {
      items: body.items,
      initiatedBy: 'FRANCHISE',
      initiatorId: req.franchiseId,
    });
    return { success: true, message: 'Return initiated', data };
  }
}
