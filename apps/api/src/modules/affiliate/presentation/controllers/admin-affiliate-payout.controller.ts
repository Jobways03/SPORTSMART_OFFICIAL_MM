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
import { AdminAuthGuard } from '../../../../core/guards';
import { AffiliatePayoutService } from '../../application/services/affiliate-payout.service';
import {
  MarkPayoutPaidDto,
  MarkPayoutFailedDto,
} from '../dtos/affiliate-payout.dto';

/**
 * Admin endpoints for processing affiliate payout requests.
 * Mounted at /admin/affiliates/payouts so it sits cleanly alongside
 * the rest of /admin/affiliates/*.
 */
@ApiTags('Admin Affiliate Payouts')
@Controller('admin/affiliates/payouts')
@UseGuards(AdminAuthGuard)
export class AdminAffiliatePayoutController {
  constructor(private readonly payoutService: AffiliatePayoutService) {}

  @Get()
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
  async approve(
    @Req() req: Request,
    @Param('payoutRequestId') payoutRequestId: string,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.payoutService.approve({ payoutRequestId, adminId });
    return { success: true, message: 'Payout approved', data };
  }

  @Patch(':payoutRequestId/mark-paid')
  @HttpCode(HttpStatus.OK)
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
