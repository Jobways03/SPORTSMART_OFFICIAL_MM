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
import { Throttle } from '@nestjs/throttler';
import { FranchiseAuthGuard, FranchiseActiveGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { FranchiseOrdersService } from '../../application/services/franchise-orders.service';
import { BadRequestAppException } from '../../../../core/exceptions';
import {
  SellerAcceptOrderDto,
  SellerRejectOrderDto,
} from '../../../orders/presentation/dtos/seller-actions.dto';
import { UpdateFulfillmentStatusDto } from '../../../orders/presentation/dtos/update-fulfillment-status.dto';

@ApiTags('Franchise Orders')
@Controller('franchise/orders')
@UseGuards(FranchiseAuthGuard, FranchiseActiveGuard)
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

  // Phase 80 (2026-05-22) — acceptance audit Gaps #15/#16/#23.
  // DTO + idempotency + throttle parity with the seller endpoints.
  @Patch(':subOrderId/accept')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async acceptOrder(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: SellerAcceptOrderDto,
  ) {
    const data = await this.franchiseOrdersService.acceptOrder(
      subOrderId,
      req.franchiseId,
      { expectedDispatchDate: body?.expectedDispatchDate },
    );
    return { success: true, message: 'Order accepted', data };
  }

  @Patch(':subOrderId/reject')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async rejectOrder(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: SellerRejectOrderDto,
  ) {
    const data = await this.franchiseOrdersService.rejectOrder(
      subOrderId,
      req.franchiseId,
      { reason: body?.reason, note: body?.note },
    );
    return { success: true, message: data.message, data };
  }

  // Phase 82 (2026-05-23) — pack/ship audit Gap #11/#24. Symmetric
  // with seller endpoint: shared DTO + @Throttle + @Idempotent.
  @Patch(':subOrderId/status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Idempotent()
  async updateFulfillmentStatus(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: UpdateFulfillmentStatusDto,
  ) {
    const data = await this.franchiseOrdersService.updateFulfillmentStatus(
      subOrderId,
      req.franchiseId,
      body.status,
      { trackingNumber: body.trackingNumber, courierName: body.courierName },
    );
    return {
      success: true,
      message: `Order status updated to ${body.status}`,
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
