import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  AdminAuthGuard,
  PermissionsGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { PaymentsPublicFacade } from '../../application/facades/payments-public.facade';

class MarkOrderPaidDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@ApiTags('Admin Payments')
@Controller('admin/payments')
// Phase 26 (2026-05-20) — StepUpGuard added so methods that opt in via
// @RequiresStepUp are gated. Read endpoints are not annotated; only the
// money-moving mark-paid is.
@UseGuards(AdminAuthGuard, PermissionsGuard, StepUpGuard)
export class AdminPaymentsController {
  constructor(private readonly paymentsFacade: PaymentsPublicFacade) {}

  // Phase 1 (PR 1.3) — @Idempotent: admin manual mark-paid is a
  // money-state transition; a retried PATCH (double-click in the ops
  // dashboard) must not re-emit `payments.payment.captured`.
  // PR 0.12's TOCTOU close in the facade is the load-bearing guard;
  // this decorator is the cheap belt-and-braces second line.
  @Patch('orders/:masterOrderId/mark-paid')
  @Idempotent()
  @Permissions('paymentOps.transition')
  // Phase 26 (2026-05-20) — Money-state transition with no automatic
  // rollback path. Tight 1-min window so a stolen-cookie attacker
  // cannot pile up mark-paid calls on a long-running elevated session.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async markPaid(
    @Req() req: Request,
    @Param('masterOrderId') masterOrderId: string,
    @Body() dto: MarkOrderPaidDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.paymentsFacade.markOrderPaid({
      masterOrderId,
      actorType: 'ADMIN',
      actorId: adminId,
      paymentReference: dto.paymentReference,
      notes: dto.notes,
    });
    return {
      success: true,
      message: 'Order marked as paid',
      data,
    };
  }

  @Get('orders/:masterOrderId/status')
  @Permissions('paymentOps.read')
  async getStatus(@Param('masterOrderId') masterOrderId: string) {
    const data = await this.paymentsFacade.getOrderPaymentStatus(masterOrderId);
    return {
      success: true,
      message: 'Payment status retrieved',
      data,
    };
  }
}
