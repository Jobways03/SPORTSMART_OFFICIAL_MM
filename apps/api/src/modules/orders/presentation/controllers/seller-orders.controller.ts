import { Controller, Get, Patch, Param, Query, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SellerAuthGuard } from '../../../../core/guards';
import { OrdersService } from '../../application/services/orders.service';
import { BadRequestAppException } from '../../../../core/exceptions';

@ApiTags('Seller Orders')
@Controller('seller/orders')
@UseGuards(SellerAuthGuard)
export class SellerOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
    const data = await this.ordersService.listSellerOrders(
      req.sellerId,
      Math.max(1, parseInt(page || '1', 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
      { fulfillmentStatus, acceptStatus, paymentStatus, search },
    );
    return { success: true, message: 'Orders retrieved', data };
  }

  @Get(':id')
  async getOrder(@Req() req: any, @Param('id') id: string) {
    const data = await this.ordersService.getSellerOrder(id, req.sellerId);
    return { success: true, message: 'Order retrieved', data };
  }

  @Patch(':id/accept')
  async acceptOrder(@Req() req: any, @Param('id') id: string) {
    const data = await this.ordersService.sellerAcceptOrder(id, req.sellerId);
    return { success: true, message: 'Order accepted', data };
  }

  @Patch(':id/reject')
  async rejectOrder(@Req() req: any, @Param('id') id: string) {
    const data = await this.ordersService.sellerRejectOrder(id, req.sellerId);
    return { success: true, message: data.message, data };
  }

  @Patch(':id/status')
  async updateFulfillmentStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    if (!body.status) {
      throw new BadRequestAppException('status is required (PACKED, SHIPPED, FULFILLED, DELIVERED)');
    }
    const data = await this.ordersService.sellerUpdateFulfillmentStatus(
      id,
      req.sellerId,
      body.status.toUpperCase(),
    );
    return { success: true, message: `Order status updated to ${body.status.toUpperCase()}`, data };
  }
}
