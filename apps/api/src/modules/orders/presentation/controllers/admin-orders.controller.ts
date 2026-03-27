import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { OrdersService } from '../../application/services/orders.service';

@ApiTags('Admin Orders')
@Controller('admin/orders')
@UseGuards(AdminAuthGuard)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async listOrders(
    @Query('page') page?: string, @Query('limit') limit?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('acceptStatus') acceptStatus?: string,
    @Query('orderStatus') orderStatus?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.ordersService.listOrders({
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
      paymentStatus, fulfillmentStatus, acceptStatus, orderStatus, search,
    });
    return { success: true, message: 'Orders retrieved', data };
  }

  @Get(':id')
  async getOrder(@Param('id') id: string) {
    const data = await this.ordersService.getOrder(id);
    return { success: true, message: 'Order retrieved', data };
  }

  // POST /admin/orders/:orderId/verify — verify order, run allocation, route to sellers
  @Post(':id/verify')
  async verifyOrder(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { remarks?: string },
  ) {
    const data = await this.ordersService.verifyOrder(id, req.userId, body.remarks);
    return { success: true, message: 'Order verified and routed to sellers', data };
  }

  @Patch(':id/reject-order')
  async rejectOrder(@Param('id') id: string) {
    await this.ordersService.rejectOrder(id);
    return { success: true, message: 'Order rejected and cancelled — stock restored' };
  }

  @Patch('sub-orders/:id/accept')
  async acceptSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.acceptSubOrder(id);
    return { success: true, message: 'Sub-order accepted', data };
  }

  @Patch('sub-orders/:id/reject')
  async rejectSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.rejectSubOrder(id);
    return { success: true, message: 'Sub-order rejected', data };
  }

  @Patch('sub-orders/:id/fulfill')
  async fulfillSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.fulfillSubOrder(id);
    return { success: true, message: 'Sub-order fulfilled', data };
  }

  @Patch('sub-orders/:id/deliver')
  async deliverSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.deliverSubOrder(id);
    return { success: true, message: 'Sub-order marked as delivered — return window started', data };
  }

  @Patch(':id/mark-paid')
  async markAsPaid(@Param('id') id: string) {
    await this.ordersService.markAsPaid(id);
    return { success: true, message: 'Order marked as paid' };
  }
}
