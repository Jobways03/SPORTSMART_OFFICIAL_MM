// Phase 87 (2026-05-23) — NDR/RTO audit Gap #14.
//
// Customer-facing NDR action surface. Pre-Phase-87 a customer with a
// failed-delivery NDR could only wait for the carrier's automatic
// retry schedule (typically 1-3 attempts at the carrier's discretion).
// This controller exposes the three actions named in the audit's
// recommended architecture:
//
//   REATTEMPT         — request another delivery attempt
//   CONVERT_TO_RTO    — give up on delivery, send back to seller
//   UPDATE_ADDRESS    — push a corrected address + reattempt
//
// The customer auth guard ensures the requester owns the sub-order
// (verified by joining MasterOrder.customerId against req.userId
// inside the service).

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import { UserAuthGuard } from '../../../../core/guards';
import { CurrentCustomer } from '../../../../core/decorators/current-actor.decorator';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  NdrRtoService,
  type NdrCustomerAction,
} from '../../application/services/ndr-rto.service';

export class CustomerNdrActionDto {
  @IsString()
  @IsIn(['REATTEMPT', 'CONVERT_TO_RTO', 'UPDATE_ADDRESS'])
  action!: NdrCustomerAction;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  newAddress?: string;

  @IsOptional()
  @IsString()
  @Length(0, 256)
  reason?: string;
}

@ApiTags('Customer Shipping')
@Controller('customer/sub-orders')
@UseGuards(UserAuthGuard)
export class CustomerNdrController {
  constructor(
    private readonly ndrRtoService: NdrRtoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /customer/sub-orders/:subOrderId/ndr-action
   *
   * Customer-driven response to an active NDR. Verifies ownership
   * (sub-order's master-order customerId must match the auth'd user)
   * before delegating to the shared service.
   */
  @Post(':subOrderId/ndr-action')
  @HttpCode(HttpStatus.OK)
  async submitNdrAction(
    @CurrentCustomer() userId: string,
    @Param('subOrderId') subOrderId: string,
    @Body() body: CustomerNdrActionDto,
  ): Promise<{ outcome: 'OK' | 'CARRIER_ERROR'; message?: string }> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        ndrAttemptCount: true,
        ndrStatus: true,
        masterOrder: { select: { customerId: true } },
      },
    });
    if (!sub) {
      throw new NotFoundAppException(`Sub-order ${subOrderId} not found`);
    }
    if (sub.masterOrder.customerId !== userId) {
      // Pretend the sub-order doesn't exist so a bystander can't
      // enumerate IDs by probing.
      throw new NotFoundAppException(`Sub-order ${subOrderId} not found`);
    }
    if (sub.ndrAttemptCount === 0) {
      throw new BadRequestAppException(
        'No active NDR on this sub-order',
      );
    }
    if (body.action === 'UPDATE_ADDRESS' && !body.newAddress) {
      throw new BadRequestAppException(
        '`newAddress` is required when action=UPDATE_ADDRESS',
      );
    }

    return this.ndrRtoService.handleNdrAction({
      subOrderId,
      action: body.action,
      actorId: userId,
      actorType: 'CUSTOMER',
      newAddress: body.newAddress,
      reason: body.reason,
    });
  }
}
