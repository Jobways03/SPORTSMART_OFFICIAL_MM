import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  ChargebackStatus,
  PaymentMismatchStatus,
  PaymentMismatchKind,
} from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { PaymentOpsService } from '../../application/services/payment-ops.service';
import { ChargebackService } from '../../application/services/chargeback.service';
import {
  BulkTransitionDto,
  ChargebackEvidenceDto,
  TransitionAlertDto,
} from '../dtos/payment-ops.dto';
import { KIND_LABELS } from '../kind-labels';

@ApiTags('Admin Payment Ops')
@Controller('admin/payment-ops')
@UseGuards(AdminAuthGuard, PermissionsGuard)
// Phase 169 (#7) — module-level read throttle; mutating routes tighten it below.
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AdminPaymentOpsController {
  constructor(
    private readonly service: PaymentOpsService,
    private readonly chargebacks: ChargebackService,
  ) {}

  @Get('alerts')
  @Permissions('paymentOps.read')
  async listAlerts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('minSeverity') minSeverity?: string,
  ) {
    const data = await this.service.listAlerts({
      page: parseInt(page || '1', 10) || 1,
      // Phase 169 — cap the page size (was uncapped — minor exposure).
      limit: Math.min(100, parseInt(limit || '20', 10) || 20),
      status: status ? (status as PaymentMismatchStatus) : undefined,
      kind: kind ? (kind as PaymentMismatchKind) : undefined,
      search: search?.trim() || undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      minSeverity: minSeverity ? parseInt(minSeverity, 10) : undefined,
    });
    return { success: true, message: 'Alerts retrieved', data };
  }

  // Phase 169 (#14) — kind labels served from the backend so adding a kind
  // doesn't require a coordinated UI change.
  @Get('kind-labels')
  @Permissions('paymentOps.read')
  kindLabels() {
    return { success: true, message: 'Kind labels', data: KIND_LABELS };
  }

  @Get('metrics')
  @Permissions('paymentOps.read')
  async metrics(@Query('days') days?: string) {
    const data = await this.service.getMetrics(days ? parseInt(days, 10) : 7);
    return { success: true, message: 'Metrics retrieved', data };
  }

  // Phase 169 (#3) — the failed-payments surface.
  @Get('failed-payments')
  @Permissions('paymentOps.read')
  async failedPayments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.service.listFailedPayments({
      page: parseInt(page || '1', 10) || 1,
      limit: Math.min(100, parseInt(limit || '20', 10) || 20),
      search: search?.trim() || undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
    return { success: true, message: 'Failed payments retrieved', data };
  }

  // Phase 169 (#1/#2) — chargebacks surface.
  @Get('chargebacks')
  @Permissions('paymentOps.read')
  async listChargebacks(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('evidenceDueWithinHours') evidenceDueWithinHours?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.chargebacks.listChargebacks({
      page: parseInt(page || '1', 10) || 1,
      limit: Math.min(100, parseInt(limit || '20', 10) || 20),
      status: status ? (status as ChargebackStatus) : undefined,
      evidenceDueWithinHours: evidenceDueWithinHours
        ? parseInt(evidenceDueWithinHours, 10)
        : undefined,
      search: search?.trim() || undefined,
    });
    return { success: true, message: 'Chargebacks retrieved', data };
  }

  @Get('chargebacks/:id')
  @Permissions('paymentOps.read')
  async getChargeback(@Param('id') id: string) {
    const data = await this.chargebacks.getChargeback(id);
    return { success: true, message: 'Chargeback retrieved', data };
  }

  @Post('chargebacks/:id/evidence')
  @Permissions('paymentOps.chargeback.respond')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async submitEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ChargebackEvidenceDto,
  ) {
    const data = await this.chargebacks.markEvidenceSubmitted({
      id,
      adminId: req.adminId,
      notes: body?.notes,
    });
    return { success: true, message: 'Evidence recorded', data };
  }

  @Get('alerts/:id')
  @Permissions('paymentOps.read')
  async getAlert(@Param('id') id: string) {
    const data = await this.service.getAlert(id);
    return { success: true, message: 'Alert retrieved', data };
  }

  @Patch('alerts/:id/status')
  @Permissions('paymentOps.transition')
  // Phase 169 (#7) — tighter limit on the money-impact transition.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async transition(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: TransitionAlertDto,
  ) {
    const data = await this.service.transitionAlert({
      id,
      status: body.status,
      notes: body.notes,
      adminId: req.adminId,
      expectedFromStatus: body.expectedFromStatus,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    return { success: true, message: 'Alert updated', data };
  }

  // Phase 169 (#16) — bulk transition (audited per row inside the service).
  @Post('alerts/bulk-transition')
  @Permissions('paymentOps.transition')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async bulkTransition(@Req() req: any, @Body() body: BulkTransitionDto) {
    const data = await this.service.bulkTransition({
      ids: body.ids,
      status: body.status,
      notes: body.notes,
      adminId: req.adminId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    return { success: true, message: 'Bulk transition complete', data };
  }

  @Get('orders/:masterOrderId/attempts')
  @Permissions('paymentOps.read')
  async attemptsForOrder(@Param('masterOrderId') masterOrderId: string) {
    const data = await this.service.listAttemptsForOrder(masterOrderId);
    return { success: true, message: 'Attempts retrieved', data };
  }
}
