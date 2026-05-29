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
import { Throttle } from '@nestjs/throttler';
import { SellerAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { OrdersService } from '../../application/services/orders.service';
import {
  SellerAcceptOrderDto,
  SellerRejectOrderDto,
} from '../dtos/seller-actions.dto';
import { UpdateFulfillmentStatusDto } from '../dtos/update-fulfillment-status.dto';

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

  // Phase 80 (2026-05-22) — acceptance audit Gaps #15/#16/#23.
  //   • DTO validates expectedDispatchDate as ISO8601 (Gap #16).
  //   • @Idempotent guards against double-tap (Gap #15) — the
  //     underlying service is FSM-idempotent but the decorator
  //     returns the same response shape on retry rather than 400.
  //   • @Throttle caps a misbehaving seller bot (Gap #23).
  @Patch(':id/accept')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async acceptOrder(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SellerAcceptOrderDto,
  ) {
    const data = await this.ordersService.sellerAcceptOrder(id, req.sellerId, {
      expectedDispatchDate: body?.expectedDispatchDate,
    });
    return { success: true, message: 'Order accepted', data };
  }

  @Patch(':id/reject')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async rejectOrder(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SellerRejectOrderDto,
  ) {
    const data = await this.ordersService.sellerRejectOrder(id, req.sellerId, {
      reason: body?.reason,
      note: body?.note,
    });
    return { success: true, message: data.message, data };
  }

  // Phase 82 (2026-05-23) — pack/ship audit Gaps #11/#24.
  //   • DTO validates status enum (PACKED/SHIPPED only), AWB
  //     format (alphanumeric 8-30), courier (enum of mapped
  //     couriers) at the pipe layer (Gap #11).
  //   • @Throttle caps misbehaving seller bots.
  //   • @Idempotent so a double-click retry returns the cached
  //     response instead of a confusing FSM-rejection 400 (Gap #24).
  @Patch(':id/status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Idempotent()
  async updateFulfillmentStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateFulfillmentStatusDto,
  ) {
    const data = await this.ordersService.sellerUpdateFulfillmentStatus(
      id,
      req.sellerId,
      body.status,
      {
        trackingNumber: body?.trackingNumber,
        courierName: body?.courierName,
      },
    );
    return {
      success: true,
      message: `Order status updated to ${body.status}`,
      data,
    };
  }

  // Phase 108 (2026-05-25) — the old self-serve POST :subOrderId/return was
  // removed. It executed immediately (stock credit + sub-order CANCELLED) with
  // no record, approval, commission/settlement effect, or audit. Off-platform
  // reversals now go through the admin-approved flow: POST /seller/reversals
  // (SellerReversalsController in the returns module).
}
