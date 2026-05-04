import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PaymentMismatchStatus, PaymentMismatchKind } from '@prisma/client';
import { AdminAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { PaymentOpsService } from '../../application/services/payment-ops.service';

interface TransitionDto {
  status: PaymentMismatchStatus;
  notes?: string;
}

@ApiTags('Admin Payment Ops')
@Controller('admin/payment-ops')
@UseGuards(AdminAuthGuard)
export class AdminPaymentOpsController {
  constructor(private readonly service: PaymentOpsService) {}

  @Get('alerts')
  async listAlerts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.service.listAlerts({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      status: status ? (status as PaymentMismatchStatus) : undefined,
      kind: kind ? (kind as PaymentMismatchKind) : undefined,
      search: search?.trim() || undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
    return { success: true, message: 'Alerts retrieved', data };
  }

  @Get('metrics')
  async metrics(@Query('days') days?: string) {
    const data = await this.service.getMetrics(
      days ? parseInt(days, 10) : 7,
    );
    return { success: true, message: 'Metrics retrieved', data };
  }

  @Get('alerts/:id')
  async getAlert(@Param('id') id: string) {
    const data = await this.service.getAlert(id);
    return { success: true, message: 'Alert retrieved', data };
  }

  @Patch('alerts/:id/status')
  async transition(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: TransitionDto,
  ) {
    if (!body?.status) throw new BadRequestAppException('status is required');
    const data = await this.service.transitionAlert({
      id,
      status: body.status,
      notes: body.notes,
      adminId: req.adminId,
    });
    return { success: true, message: 'Alert updated', data };
  }

  @Get('orders/:masterOrderId/attempts')
  async attemptsForOrder(@Param('masterOrderId') masterOrderId: string) {
    const data = await this.service.listAttemptsForOrder(masterOrderId);
    return { success: true, message: 'Attempts retrieved', data };
  }
}
