import { Controller, Get, Patch, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SellerAuthGuard } from '../../../../core/guards';
import { OrdersService } from '../../application/services/orders.service';

@ApiTags('Seller Orders')
@Controller('seller/orders')
@UseGuards(SellerAuthGuard)
export class SellerOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async listOrders(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    const data = await this.ordersService.listSellerOrders(
      req.sellerId,
      Math.max(1, parseInt(page || '1', 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
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
    return { success: true, message: 'Order rejected', data };
  }
}
