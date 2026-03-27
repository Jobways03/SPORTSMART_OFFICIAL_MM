import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { SellerAuthGuard } from '../../../core/guards';
import { NotFoundAppException, BadRequestAppException } from '../../../core/exceptions';
import { OrdersService } from '../application/services/orders.service';

@ApiTags('Seller Orders')
@Controller('seller/orders')
@UseGuards(SellerAuthGuard)
export class SellerOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  // GET /seller/orders — list sub-orders for this seller (paginated, filterable by status)
  @Get()
  async listOrders(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('acceptStatus') acceptStatus?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const data = await this.ordersService.listSellerOrders(
      req.sellerId,
      pageNum,
      limitNum,
      { fulfillmentStatus, acceptStatus, paymentStatus, search },
    );

    return { success: true, message: 'Orders retrieved', data };
  }

  // GET /seller/orders/:subOrderId — get sub-order detail with items
  @Get(':id')
  async getOrder(@Req() req: any, @Param('id') id: string) {
    const data = await this.ordersService.getSellerOrder(id, req.sellerId);
    return { success: true, message: 'Order retrieved', data };
  }

  // PATCH /seller/orders/:subOrderId/accept — accept the order
  @Patch(':id/accept')
  async acceptOrder(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { expectedDispatchDate?: string },
  ) {
    const data = await this.ordersService.sellerAcceptOrder(id, req.sellerId, {
      expectedDispatchDate: body?.expectedDispatchDate,
    });
    return { success: true, message: 'Order accepted', data };
  }

  // PATCH /seller/orders/:subOrderId/reject — reject the order (triggers reassignment)
  @Patch(':id/reject')
  async rejectOrder(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: 'OUT_OF_STOCK' | 'CANNOT_SHIP' | 'LOCATION_ISSUE' | 'OTHER'; note?: string },
  ) {
    const data = await this.ordersService.sellerRejectOrder(id, req.sellerId, {
      reason: body?.reason,
      note: body?.note,
    });
    return { success: true, message: data.message, data };
  }

  // PATCH /seller/orders/:subOrderId/status — update fulfillment status (PACKED, SHIPPED, etc.)
  @Patch(':id/status')
  async updateFulfillmentStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    if (!body.status) {
      throw new BadRequestAppException('status is required (PACKED, SHIPPED)');
    }
    const data = await this.ordersService.sellerUpdateFulfillmentStatus(
      id,
      req.sellerId,
      body.status.toUpperCase(),
    );
    return { success: true, message: `Order status updated to ${body.status.toUpperCase()}`, data };
  }
}
