import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../core/guards';
import { Roles } from '../../core/decorators/roles.decorator';
import { Permissions } from '../../core/decorators/permissions.decorator';
import { SettlementService } from './settlement.service';

@ApiTags('Admin Settlements')
@Controller('admin/settlements')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminSettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  /* ── POST /admin/settlements/create-cycle ── */
  @Post('create-cycle')
  @Permissions('settlements.approve')
  async createCycle(
    @Body() body: { periodStart: string; periodEnd: string },
  ) {
    if (!body.periodStart || !body.periodEnd) {
      throw new BadRequestException('periodStart and periodEnd are required');
    }

    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);

    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (periodStart >= periodEnd) {
      throw new BadRequestException('periodStart must be before periodEnd');
    }

    // Set periodEnd to end of day
    periodEnd.setHours(23, 59, 59, 999);

    const result = await this.settlementService.createCycle(periodStart, periodEnd);

    return {
      success: true,
      message: result.message,
      data: result.cycle,
    };
  }

  /* ── GET /admin/settlements/cycles ── */
  @Get('cycles')
  @Permissions('settlements.read')
  async listCycles(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const result = await this.settlementService.listCycles(pageNum, limitNum);

    return {
      success: true,
      message: 'Settlement cycles retrieved',
      data: result,
    };
  }

  /* ── GET /admin/settlements/cycles/:cycleId ── */
  @Get('cycles/:cycleId')
  @Permissions('settlements.read')
  async getCycleDetail(@Param('cycleId') cycleId: string) {
    const cycle = await this.settlementService.getCycleDetail(cycleId);

    if (!cycle) {
      throw new NotFoundException('Settlement cycle not found');
    }

    return {
      success: true,
      message: 'Settlement cycle detail retrieved',
      data: cycle,
    };
  }

  /* ── PATCH /admin/settlements/cycles/:cycleId/approve ── */
  @Patch('cycles/:cycleId/approve')
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.approve')
  async approveCycle(@Param('cycleId') cycleId: string) {
    const result = await this.settlementService.approveCycle(cycleId);

    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return {
      success: true,
      message: result.message,
    };
  }

  /* ── PATCH /admin/settlements/:settlementId/mark-paid ── */
  @Patch(':settlementId/mark-paid')
  @Roles('SUPER_ADMIN')
  @Permissions('settlements.markPaid')
  async markPaid(
    @Req() req: Request,
    @Param('settlementId') settlementId: string,
    @Body() body: { utrReference: string },
  ) {
    if (!body.utrReference?.trim()) {
      throw new BadRequestException('utrReference is required');
    }

    const result = await this.settlementService.markSettlementPaid(
      settlementId,
      body.utrReference.trim(),
      {
        adminId: (req as any).adminId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      },
    );

    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return {
      success: true,
      message: result.message,
    };
  }

  /* ── GET /admin/settlements/margin-summary ── */
  @Get('margin-summary')
  @Permissions('settlements.read')
  async getMarginSummary() {
    const data = await this.settlementService.getAdminMarginSummary();

    return {
      success: true,
      message: 'Admin margin summary retrieved',
      data,
    };
  }

  /* ── GET /admin/settlements/seller-breakdown ── */
  @Get('seller-breakdown')
  @Permissions('settlements.read')
  async getSellerBreakdown(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const data = await this.settlementService.getAdminSellerBreakdown(pageNum, limitNum);

    return {
      success: true,
      message: 'Per-seller breakdown retrieved',
      data,
    };
  }

  /* ── T6: GET /admin/settlements/reconciliation ── */
  @Get('reconciliation')
  @Permissions('recon.read')
  async getReconciliation() {
    const data = await this.settlementService.getReconciliation();

    return {
      success: true,
      message: 'Reconciliation report generated',
      data,
    };
  }

  /* ── Manual adjustments on a settlement ── */
  @Post(':settlementId/adjustments')
  @Permissions('settlements.approve')
  async recordAdjustment(
    @Req() req: Request,
    @Param('settlementId') settlementId: string,
    @Body() body: { amount: number; reason: string; notes?: string },
  ) {
    if (typeof body?.amount !== 'number' || body.amount === 0) {
      throw new BadRequestException('amount must be a non-zero number');
    }
    if (!body?.reason?.trim()) {
      throw new BadRequestException('reason is required');
    }
    const data = await this.settlementService.recordAdjustment({
      settlementId,
      amount: body.amount,
      reason: body.reason,
      notes: body.notes,
      adminId: (req as any).adminId,
    });
    return { success: true, message: 'Adjustment recorded', data };
  }

  @Get(':settlementId/adjustments')
  @Permissions('settlements.read')
  async listAdjustments(@Param('settlementId') settlementId: string) {
    const data = await this.settlementService.listAdjustments(settlementId);
    return { success: true, message: 'Adjustments retrieved', data };
  }
}
