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
import { AdminAuthGuard } from '../../../../core/guards';
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
@UseGuards(AdminAuthGuard)
export class AdminPaymentsController {
  constructor(private readonly paymentsFacade: PaymentsPublicFacade) {}

  @Patch('orders/:masterOrderId/mark-paid')
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
  async getStatus(@Param('masterOrderId') masterOrderId: string) {
    const data = await this.paymentsFacade.getOrderPaymentStatus(masterOrderId);
    return {
      success: true,
      message: 'Payment status retrieved',
      data,
    };
  }
}
