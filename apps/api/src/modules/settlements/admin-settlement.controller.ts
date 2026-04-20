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
import { AdminAuthGuard, RolesGuard } from '../../core/guards';
import { Roles } from '../../core/decorators/roles.decorator';
import { SettlementService } from './settlement.service';

@ApiTags('Admin Settlements')
@Controller('admin/settlements')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminSettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  /* ── POST /admin/settlements/create-cycle ── */
  @Post('create-cycle')
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
  async getReconciliation() {
    const data = await this.settlementService.getReconciliation();

    return {
      success: true,
      message: 'Reconciliation report generated',
      data,
    };
  }
}
