import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
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

  @Patch(':id/reject')
  async rejectOrder(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      reason?: 'OUT_OF_STOCK' | 'CANNOT_SHIP' | 'LOCATION_ISSUE' | 'OTHER';
      note?: string;
    },
  ) {
    const data = await this.ordersService.sellerRejectOrder(id, req.sellerId, {
      reason: body?.reason,
      note: body?.note,
    });
    return { success: true, message: data.message, data };
  }

  @Patch(':id/status')
  async updateFulfillmentStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      status: string;
      trackingNumber?: string;
      courierName?: string;
    },
  ) {
    if (!body.status) {
      throw new BadRequestAppException('status is required (PACKED, SHIPPED)');
    }
    const data = await this.ordersService.sellerUpdateFulfillmentStatus(
      id,
      req.sellerId,
      body.status.toUpperCase(),
      {
        trackingNumber: body?.trackingNumber,
        courierName: body?.courierName,
      },
    );
    return {
      success: true,
      message: `Order status updated to ${body.status.toUpperCase()}`,
      data,
    };
  }

  /**
   * Seller-initiated return — mirrors the franchise `/return` endpoint.
   * Used when the seller needs to reverse a delivered sub-order (e.g. the
   * customer returned via a B2B channel or the goods came back damaged).
   * Stock is returned to the seller's `stockQty` and the sub-order is
   * marked CANCELLED. Does not create a Return row — that lifecycle stays
   * customer-initiated.
   */
  @Post(':subOrderId/return')
  async initiateReturn(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body()
    body: {
      items: Array<{ orderItemId: string; quantity: number; reason: string }>;
    },
  ) {
    const data = await this.ordersService.sellerInitiateReturn(
      subOrderId,
      req.sellerId,
      body.items,
    );
    return { success: true, message: 'Return initiated', data };
  }
}
