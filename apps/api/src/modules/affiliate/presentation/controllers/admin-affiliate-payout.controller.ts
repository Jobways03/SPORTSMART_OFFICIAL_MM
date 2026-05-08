import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AffiliatePayoutService } from '../../application/services/affiliate-payout.service';
import {
  MarkPayoutPaidDto,
  MarkPayoutFailedDto,
  RejectPayoutDto,
} from '../dtos/affiliate-payout.dto';

/**
 * Admin endpoints for processing affiliate payout requests.
 * Mounted at /admin/affiliates/payouts so it sits cleanly alongside
 * the rest of /admin/affiliates/*.
 */
@ApiTags('Admin Affiliate Payouts')
@Controller('admin/affiliates/payouts')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminAffiliatePayoutController {
  constructor(private readonly payoutService: AffiliatePayoutService) {}

  @Get()
  @Permissions('affiliates.read')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('affiliateId') affiliateId?: string,
  ) {
    const data = await this.payoutService.listForAdmin({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      affiliateId,
    });
    return { success: true, message: 'Payouts fetched', data };
  }

  @Patch(':payoutRequestId/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.payouts')
  async approve(
    @Req() req: Request,
    @Param('payoutRequestId') payoutRequestId: string,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.payoutService.approve({ payoutRequestId, adminId });
    return { success: true, message: 'Payout approved', data };
  }

  @Patch(':payoutRequestId/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.payouts')
  async reject(
    @Req() req: Request,
    @Param('payoutRequestId') payoutRequestId: string,
    @Body() dto: RejectPayoutDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.payoutService.reject({
      payoutRequestId,
      adminId,
      reason: dto.reason,
    });
    return {
      success: true,
      message:
        'Payout rejected. Commissions released back to CONFIRMED so the affiliate can re-request.',
      data,
    };
  }

  @Patch(':payoutRequestId/mark-paid')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.payouts')
  async markPaid(
    @Req() req: Request,
    @Param('payoutRequestId') payoutRequestId: string,
    @Body() dto: MarkPayoutPaidDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.payoutService.markPaid({
      payoutRequestId,
      adminId,
      transactionRef: dto.transactionRef,
    });
    return {
      success: true,
      message: 'Payout marked paid. Bundled commissions are now PAID.',
      data,
    };
  }

  @Patch(':payoutRequestId/mark-failed')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.payouts')
  async markFailed(
    @Req() req: Request,
    @Param('payoutRequestId') payoutRequestId: string,
    @Body() dto: MarkPayoutFailedDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.payoutService.markFailed({
      payoutRequestId,
      adminId,
      reason: dto.reason,
    });
    return {
      success: true,
      message:
        'Payout marked failed. Commissions released back to CONFIRMED for re-request.',
      data,
    };
  }
}
