import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../core/guards';
import { CustomerOrdersService } from '../application/services/customer-orders.service';

@ApiTags('Customer Orders')
@Controller('customer/orders')
@UseGuards(UserAuthGuard)
export class CustomerOrdersController {
  constructor(private readonly ordersService: CustomerOrdersService) {}

  // Legacy place-order endpoint (POST /customer/orders)
  // The primary place-order flow is via POST /customer/checkout/place-order
  @Post()
  async placeOrder(@Req() req: any, @Body() body: { addressId: string }) {
    const result = await this.ordersService.placeOrder(req.userId, body.addressId);
    return {
      success: true,
      message: 'Order placed successfully',
      data: result,
    };
  }

  // PATCH /customer/orders/:orderNumber/cancel
  @Patch(':orderNumber/cancel')
  async cancelOrder(
    @Req() req: any,
    @Param('orderNumber') orderNumber: string,
  ) {
    await this.ordersService.cancelOrder(req.userId, orderNumber);
    return {
      success: true,
      message: 'Order cancelled successfully',
    };
  }
}
