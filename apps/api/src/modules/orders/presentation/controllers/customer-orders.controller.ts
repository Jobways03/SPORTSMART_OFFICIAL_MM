import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import { OrdersService } from '../../application/services/orders.service';

@ApiTags('Customer Orders')
@Controller('customer/orders')
@UseGuards(UserAuthGuard)
export class CustomerOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async listOrders(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const data = await this.ordersService.listCustomerOrders(
      req.userId,
      pageNum,
      limitNum,
    );

    return { success: true, message: 'Orders retrieved', data };
  }

  @Get(':orderNumber')
  async getOrder(
    @Req() req: any,
    @Param('orderNumber') orderNumber: string,
  ) {
    const data = await this.ordersService.getCustomerOrder(req.userId, orderNumber);
    return { success: true, message: 'Order retrieved', data };
  }
}
