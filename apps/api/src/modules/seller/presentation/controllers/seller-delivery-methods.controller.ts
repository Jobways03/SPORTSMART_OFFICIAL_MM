import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import type { DeliveryMethod, SelfDeliveryStatus } from '@prisma/client';
import type { Request } from 'express';

import { SellerAuthGuard } from '../../../../core/guards';
import { SellerDeliveryMethodsService } from '../../application/services/seller-delivery-methods.service';

// All API responses follow the shared `{ success, message, data }` envelope
// the frontend `apiClient` expects. Returning a raw object makes the UI
// fall through to "Failed to load..." even when the call returned 200.
function ok<T>(data: T, message = 'OK') {
  return { success: true, message, data };
}

/**
 * Seller-facing endpoints for the delivery flow:
 *
 *   GET  /seller/delivery-methods                         — entitlements
 *   POST /seller/sub-orders/:id/delivery-method           — choose method on accept
 *   POST /seller/sub-orders/:id/self-delivery/status      — manual status
 *
 * All routes require SellerAuthGuard so the underlying service can
 * trust `req.user.sellerId` for ownership checks.
 */

class ChooseDeliveryMethodDto {
  @IsEnum(['SELF_DELIVERY'])
  method!: DeliveryMethod;
}

class TransitionSelfDeliveryDto {
  @IsEnum([
    'PENDING',
    'READY_FOR_PICKUP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'FAILED',
    'CANCELLED',
  ])
  next!: SelfDeliveryStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

interface SellerRequest extends Request {
  user?: { sellerId?: string; id?: string };
}

@ApiTags('Seller · Delivery Methods')
@Controller('seller')
@UseGuards(SellerAuthGuard)
export class SellerDeliveryMethodsController {
  constructor(private readonly service: SellerDeliveryMethodsService) {}

  @Get('delivery-methods')
  async getEntitlements(@Req() req: SellerRequest) {
    const sellerId = req.user?.sellerId ?? req.user?.id;
    if (!sellerId) throw new Error('Missing seller context');
    const data = await this.service.getMyEntitlements(sellerId);
    return ok(data, 'Delivery method entitlements retrieved');
  }

  @Post('sub-orders/:id/delivery-method')
  @HttpCode(HttpStatus.OK)
  async choose(
    @Req() req: SellerRequest,
    @Param('id') subOrderId: string,
    @Body() body: ChooseDeliveryMethodDto,
  ) {
    const sellerId = req.user?.sellerId ?? req.user?.id;
    if (!sellerId) throw new Error('Missing seller context');
    const data = await this.service.chooseMethodForSubOrder({
      sellerId,
      subOrderId,
      method: body.method,
    });
    return ok(data, 'Delivery method set');
  }

  @Post('sub-orders/:id/self-delivery/status')
  @HttpCode(HttpStatus.OK)
  async transition(
    @Req() req: SellerRequest,
    @Param('id') subOrderId: string,
    @Body() body: TransitionSelfDeliveryDto,
  ) {
    const sellerId = req.user?.sellerId ?? req.user?.id;
    if (!sellerId) throw new Error('Missing seller context');
    const data = await this.service.transitionSelfDeliveryStatus({
      sellerId,
      subOrderId,
      next: body.next,
      notes: body.notes,
    });
    return ok(data, 'Self-delivery status updated');
  }
}
