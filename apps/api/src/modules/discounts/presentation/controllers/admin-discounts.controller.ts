import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req, HttpCode, HttpStatus, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { DiscountsService } from '../../application/services/discounts.service';
import { DiscountAnalyticsService } from '../../application/services/discount-analytics.service';
import { DiscountFraudService } from '../../application/services/discount-fraud.service';
import { DiscountAffiliateUnificationService } from '../../application/services/discount-affiliate-unification.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { CreateDiscountDto } from '../dtos/create-discount.dto';
import { UpdateDiscountDto } from '../dtos/update-discount.dto';
import { SetDiscountStatusDto } from '../dtos/set-discount-status.dto';

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
  async list(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string, @Query('status') status?: string, @Query('search') search?: string) {
    const data = await this.discountsService.list({
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50)),
      status, search,
    });
    if (Array.isArray((data as any)?.discounts)) {
      (data as any).discounts = (data as any).discounts.map((d: any) =>
        this.redactFinance(d, req),
      );
    }
    return { success: true, message: 'Discounts retrieved', data };
  }

  // Phase 243 (#19) — fundingNotes is internal P&L/strategy commentary.
  // Strip it (the row is otherwise unchanged) unless the caller holds the
  // finance read tier. Funding type/percentages stay visible — marketing
  // legitimately needs them to understand the campaign.
  private redactFinance<T extends Record<string, any>>(row: T, req: any): T {
    const perms: string[] = req?.user?.permissions ?? [];
    if (perms.includes('discounts.read.finance')) return row;
    if (row && typeof row === 'object' && 'fundingNotes' in row) {
      return { ...row, fundingNotes: undefined };
    }
    return row;
  }

  // Phase 247 (#13) — changing the funding type/split shifts who absorbs the
  // discount cost (a finance decision). A plain discounts.write holder can
  // create/edit PLATFORM-funded (default) campaigns; SELLER/BRAND/SHARED
  // funding, or any explicit funding-percent, requires discounts.write.funding.
  private assertFundingWritePermitted(body: any, req: any): void {
    const perms: string[] = req?.user?.permissions ?? [];
    if (perms.includes('discounts.write.funding')) return;
    // Gate on the VALUES that indicate genuine non-platform funding, NOT mere
    // field presence — the form sends platformFundingPercent=100 (and the
    // other shares = 0) on every save, so a presence check would wrongly
    // block an ordinary PLATFORM-funded campaign for a non-finance marketer.
    const touchesFunding =
      (body?.fundingType !== undefined && body.fundingType !== 'PLATFORM') ||
      Number(body?.sellerFundingPercent ?? 0) > 0 ||
      Number(body?.brandFundingPercent ?? 0) > 0 ||
      Number(body?.franchiseFundingPercent ?? 0) > 0 ||
      !!body?.franchiseId ||
      !!body?.brandId ||
      (body?.commissionBasis !== undefined && body.commissionBasis !== 'GROSS') ||
      (typeof body?.fundingNotes === 'string' && body.fundingNotes.trim().length > 0);
    if (touchesFunding) {
      throw new ForbiddenException(
        'Changing discount funding requires the discounts.write.funding permission (finance)',
      );
    }
  }

  // Phase 246 (#8) — validate a from/to analytics window: ISO-parseable,
  // not in the future, from <= to, and within a bounded span (366 days).
  private static readonly MAX_RANGE_DAYS = 366;
  private parseAnalyticsRange(
    fromDate?: string,
    toDate?: string,
  ): { fromDate?: Date; toDate?: Date } {
    const now = new Date();
    const range: { fromDate?: Date; toDate?: Date } = {};
    if (fromDate) {
      const d = new Date(fromDate);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('fromDate is not a valid date');
      }
      range.fromDate = d;
    }
    if (toDate) {
      const d = new Date(toDate);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('toDate is not a valid date');
      }
      if (d.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
        throw new BadRequestException('toDate cannot be in the future');
      }
      range.toDate = d;
    }
    if (range.fromDate && range.toDate) {
      if (range.fromDate.getTime() > range.toDate.getTime()) {
        throw new BadRequestException('fromDate must be on or before toDate');
      }
      const spanDays =
        (range.toDate.getTime() - range.fromDate.getTime()) /
        (24 * 60 * 60 * 1000);
      if (spanDays > AdminDiscountsController.MAX_RANGE_DAYS) {
        throw new BadRequestException(
          `Date range cannot exceed ${AdminDiscountsController.MAX_RANGE_DAYS} days`,
        );
      }
    }
    return range;
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
   * Phase 243 (#17) — now gated by the dedicated `discounts.audit`
   * permission (seeded to Marketing Manager + Super Admin) instead of
   * falling back to the broad `discounts.read`.
   */
  @Get(':id/audit-history')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.audit')
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
  // Phase 246 (#13) — the heaviest read in the admin (7+ aggregations, one a
  // raw join). Cap the burst so a runaway dashboard tab can't saturate PG.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async analyticsSummary(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    // Phase 246 (#8) — validate the range: reject NaN / future dates and cap
    // the span so a 10-year scan can't be requested.
    const range = this.parseAnalyticsRange(fromDate, toDate);
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
  // Phase 245 (#12) — the abuse telemetry carries per-customer PII and is a
  // risk-team surface, not general marketing. Re-gated from discounts.read to
  // the dedicated discounts.abuse.read tier (+ @Throttle so an internal
  // scraper can't pull the whole coupon_attempts table).
  // Phase 247-FB — funding-party receivables (who owes what for franchise/
  // brand-funded discounts). Finance-tier read; the BRAND figures are the
  // manual-billing basis, the FRANCHISE figures cross-check the auto-deduction
  // in the franchise settlement.
  @Get('funding/receivables')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.read.finance')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async fundingReceivables(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const range = this.parseAnalyticsRange(fromDate, toDate);
    const data = await this.analytics.getFundingReceivables(range);
    return { success: true, message: 'Funding receivables retrieved', data };
  }

  @Get('analytics/abuse/top-codes')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.abuse.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async topAbusedCodes(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
  ) {
    const { fromDate: from, toDate: to } = this.parseAbuseRange(fromDate, toDate);
    const lim = Math.min(100, Math.max(1, parseInt(limit ?? '25', 10) || 25));
    const data = await this.fraud.getTopAbusedCodes(
      { fromDate: from, toDate: to },
      lim,
    );
    return { success: true, message: 'Top abused codes retrieved', data };
  }

  /**
   * Phase E (P1.4) — paginated raw attempts feed for the admin abuse
   * drill-in. Phase 245 (#13): customer/device ids are masked unless the
   * caller holds the action tier (which needs identities to act).
   */
  @Get('analytics/abuse/attempts')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.abuse.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listAbuseAttempts(
    @Req() req: any,
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
      revealPii: this.canRevealAbusePii(req),
    });
    return { success: true, message: 'Coupon attempts retrieved', data };
  }

  /**
   * Phase 245 (abuse-detection audit #1) — per-customer-per-coupon
   * concentration: the named "disproportionate single-account usage" signal.
   * Read-only telemetry; the full alert/FSM/scoring/action subsystem is the
   * surfaced follow-up.
   */
  @Get('analytics/abuse/concentration')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.abuse.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async couponConcentration(
    @Req() req: any,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('minRedemptions') minRedemptions?: string,
    @Query('thresholdPct') thresholdPct?: string,
    @Query('limit') limit?: string,
  ) {
    const { fromDate: from, toDate: to } = this.parseAbuseRange(fromDate, toDate);
    const data = await this.fraud.getCouponConcentration({
      fromDate: from,
      toDate: to,
      minRedemptions: minRedemptions ? parseInt(minRedemptions, 10) : undefined,
      thresholdPct: thresholdPct ? parseInt(thresholdPct, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      revealPii: this.canRevealAbusePii(req),
    });
    return { success: true, message: 'Coupon concentration retrieved', data };
  }

  // The action tier needs real identities to block a customer / suspend a
  // coupon; a read-only abuse viewer sees masked ids.
  private canRevealAbusePii(req: any): boolean {
    const perms: string[] = req?.user?.permissions ?? [];
    return perms.includes('discounts.abuse.action');
  }

  // Abuse range: default last 30 days, cap span + reject future (lighter than
  // the analytics DTO — these are risk reads, not finance).
  private parseAbuseRange(
    fromDate?: string,
    toDate?: string,
  ): { fromDate: Date; toDate: Date } {
    const r = this.parseAnalyticsRange(fromDate, toDate);
    const to = r.toDate ?? new Date();
    const from = r.fromDate ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { fromDate: from, toDate: to };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.read')
  async get(@Req() req: any, @Param('id') id: string) {
    const data = await this.discountsService.get(id);
    return {
      success: true,
      message: 'Discount retrieved',
      data: this.redactFinance(data, req),
    };
  }

  // Discount mutations move revenue — a bad percentage value or a mass
  // "100% OFF" code hands out free products at scale. Typed DTO (#1) +
  // @Idempotent (#12) + actor attribution (#4) + funding-write gate (#247).
  // #16: access is gated by the discounts.write PERMISSION (which seller-
  // admins do not hold unless granted a marketing custom role); the coarse
  // @Roles stays as a secondary gate. The substantive seller-cost concern is
  // closed by assertFundingWritePermitted — a non-finance writer cannot set
  // SELLER/BRAND/SHARED funding. A dedicated MARKETING_ADMIN AdminRole is a
  // larger enum-migration + reseed, surfaced as follow-up.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('discounts.write')
  @Idempotent()
  async create(@Req() req: any, @Body() body: CreateDiscountDto) {
    this.assertFundingWritePermitted(body, req);
    const data = await this.discountsService.create(body, {
      actorId: req.adminId,
      actorRole: req.adminRole,
    });
    return {
      success: true,
      message: 'Discount created',
      data: this.redactFinance(data, req),
    };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('discounts.write')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: UpdateDiscountDto) {
    this.assertFundingWritePermitted(body, req);
    const data = await this.discountsService.update(id, body, {
      actorId: req.adminId,
      actorRole: req.adminRole,
    });
    return {
      success: true,
      message: 'Discount updated',
      data: this.redactFinance(data, req),
    };
  }

  // Phase 243 (#6/#7) — dedicated status FSM. Status can no longer be flipped
  // via the generic update body; Pause/Resume/Archive/publish-from-DRAFT go
  // here with a validated transition + audit.
  @Put(':id/status')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('discounts.write')
  async setStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SetDiscountStatusDto,
  ) {
    const data = await this.discountsService.setStatus(
      id,
      body.status,
      { actorId: req.adminId, actorRole: req.adminRole },
      body.reason,
    );
    return { success: true, message: 'Discount status updated', data };
  }

  // Phase 245 (#15) — risk surface: suspend / un-suspend a leaking coupon.
  // Separate, higher-tier permission than ordinary marketing edits; only
  // this path can move a coupon in/out of SUSPENDED_FOR_ABUSE.
  @Post(':id/abuse/suspend')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.abuse.action')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async suspendForAbuse(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const data = await this.discountsService.suspendForAbuse(
      id,
      true,
      { actorId: req.adminId, actorRole: req.adminRole },
      body?.reason,
    );
    return { success: true, message: 'Discount suspended for abuse', data };
  }

  @Post(':id/abuse/unsuspend')
  @HttpCode(HttpStatus.OK)
  @Permissions('discounts.abuse.action')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async unsuspendForAbuse(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const data = await this.discountsService.suspendForAbuse(
      id,
      false,
      { actorId: req.adminId, actorRole: req.adminRole },
      body?.reason,
    );
    return { success: true, message: 'Discount un-suspended', data };
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
