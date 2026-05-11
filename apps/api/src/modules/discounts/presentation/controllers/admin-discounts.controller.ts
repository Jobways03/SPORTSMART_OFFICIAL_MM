import { Controller, Get, Post, Put, Delete, Param, Query, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { DiscountsService } from '../../application/services/discounts.service';
import { DiscountAnalyticsService } from '../../application/services/discount-analytics.service';
import { DiscountFraudService } from '../../application/services/discount-fraud.service';
import { DiscountAffiliateUnificationService } from '../../application/services/discount-affiliate-unification.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

@ApiTags('Admin Discounts')
@Controller('admin/discounts')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminDiscountsController {
  constructor(
    private readonly discountsService: DiscountsService,
    private readonly analytics: DiscountAnalyticsService,
    private readonly fraud: DiscountFraudService,
    private readonly affiliateUnification: DiscountAffiliateUnificationService,
    private readonly audit: AuditPublicFacade,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.read')
  async list(@Query('page') page?: string, @Query('limit') limit?: string, @Query('status') status?: string, @Query('search') search?: string) {
    const data = await this.discountsService.list({
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50)),
      status, search,
    });
    return { success: true, message: 'Discounts retrieved', data };
  }

  /**
   * Phase F (P2.2) — campaign analytics dashboard endpoint.
   *
   * Returns aggregate spend / liability / refund / top-coupon /
   * abuse stubs over a date range (default last 30 days). Backs
   * the admin /dashboard/discounts/analytics page.
   *
   * Permission: `discounts.read` (same as list — analytics is a
   * read-only roll-up over data the admin can already see).
   */
  /**
   * Phase E (P1.1) — discount audit history. Backs the audit-history
   * panel on the discount detail page. Returns AuditLog rows
   * filtered to module=discounts + resourceId=discountId, newest
   * first.
   *
   * Permission: `discounts.audit` if it exists in the registry,
   * otherwise falls back to `discounts.read`. Currently the
   * permission registry has only discounts.read / discounts.write,
   * so we use read here and add a dedicated audit permission as a
   * follow-up alongside the rest of the P1 audit gating.
   */
  @Get(':id/audit-history')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.read')
  async auditHistory(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    const data = await this.audit.searchAuditHistory({
      module: 'discounts',
      resource: 'discount',
      limit: lim,
      // Repository scopes to resourceId via filters when available;
      // we filter post-fetch for the discount we care about so this
      // works across audit-repo schema variations.
    });
    const filtered = (data as Array<{ resourceId?: string }>).filter(
      (row) => row.resourceId === id,
    );
    return {
      success: true,
      message: 'Discount audit history retrieved',
      data: filtered,
    };
  }

  @Get('analytics/summary')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.read')
  async analyticsSummary(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const range: { fromDate?: Date; toDate?: Date } = {};
    if (fromDate) {
      const d = new Date(fromDate);
      if (!Number.isNaN(d.getTime())) range.fromDate = d;
    }
    if (toDate) {
      const d = new Date(toDate);
      if (!Number.isNaN(d.getTime())) range.toDate = d;
    }
    const [data, abuseStats] = await Promise.all([
      this.analytics.getAnalytics(range),
      // Phase E (P1.4) — light up the abuse card on the analytics
      // dashboard with real coupon_attempts data instead of zeros.
      this.fraud.getAttemptStats({
        fromDate: range.fromDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        toDate: range.toDate ?? new Date(),
      }),
    ]);
    return {
      success: true,
      message: 'Discount analytics retrieved',
      data: {
        ...data,
        abuse: {
          attemptCount: abuseStats.invalid + abuseStats.blocked + abuseStats.expired + abuseStats.notEligible,
          blockedCount: abuseStats.blocked,
          validCount: abuseStats.valid,
        },
      },
    };
  }

  /**
   * Phase E (P1.4) — Top-attempted invalid coupon codes within a
   * window. Backs the admin abuse panel.
   */
  @Get('analytics/abuse/top-codes')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.read')
  async topAbusedCodes(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
  ) {
    const to = toDate ? new Date(toDate) : new Date();
    const from = fromDate
      ? new Date(fromDate)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const lim = Math.min(100, Math.max(1, parseInt(limit ?? '25', 10) || 25));
    const data = await this.fraud.getTopAbusedCodes(
      { fromDate: from, toDate: to },
      lim,
    );
    return { success: true, message: 'Top abused codes retrieved', data };
  }

  /**
   * Phase E (P1.4) — paginated raw attempts feed for the admin
   * abuse drill-in.
   */
  @Get('analytics/abuse/attempts')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.read')
  async listAbuseAttempts(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('result') result?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const to = toDate ? new Date(toDate) : undefined;
    const from = fromDate ? new Date(fromDate) : undefined;
    const validResults = ['VALID', 'INVALID', 'EXPIRED', 'NOT_ELIGIBLE', 'BLOCKED'];
    const safeResult = validResults.includes(result ?? '')
      ? (result as any)
      : undefined;
    const data = await this.fraud.listAttempts({
      fromDate: from,
      toDate: to,
      result: safeResult,
      page: Math.max(1, parseInt(page ?? '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50)),
    });
    return { success: true, message: 'Coupon attempts retrieved', data };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.read')
  async get(@Param('id') id: string) {
    const data = await this.discountsService.get(id);
    return { success: true, message: 'Discount retrieved', data };
  }

  // Discount mutations move revenue — a bad percentage value or a mass
  // "100% OFF" code hands out free products at scale. Gate at the same
  // tier as commission-record adjustment and return-refund movement.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('discounts.write')
  async create(@Body() body: any) {
    const data = await this.discountsService.create(body);
    return { success: true, message: 'Discount created', data };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('discounts.write')
  async update(@Param('id') id: string, @Body() body: any) {
    const data = await this.discountsService.update(id, body);
    return { success: true, message: 'Discount updated', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('discounts.write')
  async delete(@Param('id') id: string) {
    await this.discountsService.delete(id);
    return { success: true, message: 'Discount deleted' };
  }

  // ─────────────────────────────────────────────────────────────
  // Phase F (P2.3) — Affiliate ↔ Discount unification.
  //
  // Legacy AffiliateCouponCode rows can be promoted into the unified
  // Discount pipeline so they inherit every Phase B–F feature
  // (eligibility, fraud, allocation, ledger, audit, budget). The
  // bulk endpoint walks every unmigrated row; the per-coupon
  // endpoint handles one-off migration of a specific code.
  // ─────────────────────────────────────────────────────────────

  @Post('affiliate/unify/:affiliateCouponCodeId')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('discounts.write')
  async unifyAffiliateCoupon(@Param('affiliateCouponCodeId') id: string) {
    const data = await this.affiliateUnification.unifyExistingCoupon(id);
    return { success: true, message: 'Affiliate coupon unified', data };
  }

  @Post('affiliate/unify')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @Permissions('discounts.write')
  async unifyAllAffiliateCoupons() {
    const data = await this.affiliateUnification.unifyAllPending();
    return { success: true, message: 'Affiliate coupon backfill complete', data };
  }
}
