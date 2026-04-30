import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { AffiliateCommissionService } from '../../application/services/affiliate-commission.service';
import { AffiliateCommissionHoldDto } from '../dtos/affiliate-commission-hold.dto';

/**
 * Admin browser for affiliate commissions. Separate controller from
 * `admin/affiliates` to avoid colliding with `:affiliateId` — Nest
 * matches static paths against dynamic params in declaration order,
 * and a sibling controller mount keeps routing unambiguous.
 */
@ApiTags('Admin Affiliate Commissions')
@Controller('admin/affiliates/commissions')
@UseGuards(AdminAuthGuard)
export class AdminAffiliateCommissionController {
  constructor(private readonly commissionService: AffiliateCommissionService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('source') source?: 'LINK' | 'COUPON',
    @Query('affiliateId') affiliateId?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.commissionService.listForAdmin({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      source,
      affiliateId,
      search,
    });
    return { success: true, message: 'Commissions fetched', data };
  }

  @Get('totals')
  async totals() {
    const data = await this.commissionService.getAdminTotals();
    return { success: true, message: 'Commission totals', data };
  }

  /**
   * Manually pause a commission while an exchange / dispute is in
   * progress. Allowed from PENDING or CONFIRMED only — the service
   * rejects HOLD-from-PAID/REVERSED. Reason is surfaced to the
   * affiliate so they understand why their commission is paused.
   */
  @Patch(':commissionId/hold')
  @HttpCode(HttpStatus.OK)
  async placeOnHold(
    @Param('commissionId') commissionId: string,
    @Body() dto: AffiliateCommissionHoldDto,
  ) {
    const data = await this.commissionService.hold(commissionId, dto.reason);
    return { success: true, message: 'Commission placed on hold', data };
  }

  /**
   * Release a commission from HOLD back to PENDING. The return-window
   * cron resumes from there. If the resolved exchange reduces the
   * order value, callers should also use applyAdjustment with the
   * delta (not exposed on this endpoint — manual SQL for now).
   */
  @Patch(':commissionId/resume')
  @HttpCode(HttpStatus.OK)
  async resumeFromHold(@Param('commissionId') commissionId: string) {
    const data = await this.commissionService.resumeFromHold(commissionId);
    return { success: true, message: 'Commission resumed', data };
  }
}
