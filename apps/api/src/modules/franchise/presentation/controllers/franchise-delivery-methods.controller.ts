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

import { FranchiseAuthGuard } from '../../../../core/guards';
import { FranchiseDeliveryMethodsService } from '../../application/services/franchise-delivery-methods.service';

function ok<T>(data: T, message = 'OK') {
  return { success: true, message, data };
}

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

interface FranchiseRequest extends Request {
  user?: { franchiseId?: string; id?: string };
}

@ApiTags('Franchise · Delivery Methods')
@Controller('franchise')
@UseGuards(FranchiseAuthGuard)
export class FranchiseDeliveryMethodsController {
  constructor(private readonly service: FranchiseDeliveryMethodsService) {}

  @Get('delivery-methods')
  async getEntitlements(@Req() req: FranchiseRequest) {
    const franchiseId = req.user?.franchiseId ?? req.user?.id;
    if (!franchiseId) throw new Error('Missing franchise context');
    const data = await this.service.getMyEntitlements(franchiseId);
    return ok(data, 'Delivery method entitlements retrieved');
  }

  @Post('sub-orders/:id/delivery-method')
  @HttpCode(HttpStatus.OK)
  async choose(
    @Req() req: FranchiseRequest,
    @Param('id') subOrderId: string,
    @Body() body: ChooseDeliveryMethodDto,
  ) {
    const franchiseId = req.user?.franchiseId ?? req.user?.id;
    if (!franchiseId) throw new Error('Missing franchise context');
    const data = await this.service.chooseMethodForSubOrder({
      franchiseId,
      subOrderId,
      method: body.method,
    });
    return ok(data, 'Delivery method set');
  }

  @Post('sub-orders/:id/self-delivery/status')
  @HttpCode(HttpStatus.OK)
  async transition(
    @Req() req: FranchiseRequest,
    @Param('id') subOrderId: string,
    @Body() body: TransitionSelfDeliveryDto,
  ) {
    const franchiseId = req.user?.franchiseId ?? req.user?.id;
    if (!franchiseId) throw new Error('Missing franchise context');
    const data = await this.service.transitionSelfDeliveryStatus({
      franchiseId,
      subOrderId,
      next: body.next,
      notes: body.notes,
    });
    return ok(data, 'Self-delivery status updated');
  }
}
