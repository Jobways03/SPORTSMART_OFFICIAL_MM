import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  AdminAuthGuard,
  PermissionsGuard,
  RolesGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { AffiliateRegistrationService } from '../../application/services/affiliate-registration.service';
import { AffiliateKycService } from '../../application/services/affiliate-kyc.service';
import {
  CreateAdditionalCouponDto,
  ReactivateAffiliateDto,
  RejectAffiliateDto,
  SuspendAffiliateDto,
  UpdateCommissionRateDto,
  UpdateCouponConfigDto,
} from '../dtos/register-affiliate.dto';
import { RejectAffiliateKycDto } from '../dtos/affiliate-kyc.dto';

/**
 * Admin endpoints for managing affiliate applications. Mounted on
 * /admin/affiliates. Authorisation enforced by AdminAuthGuard;
 * actor's adminId is read from the request (set by the guard) and
 * recorded in the affiliate row for audit.
 */
@ApiTags('Admin Affiliates')
@Controller('admin/affiliates')
// Phase 159 — RolesGuard added to the chain so a route-level @Roles is
// enforced (the commission-rate endpoint is SUPER_ADMIN-only). RolesGuard
// no-ops on routes without @Roles, so the other endpoints are unaffected.
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminAffiliateController {
  constructor(
    private readonly registrationService: AffiliateRegistrationService,
    private readonly kycService: AffiliateKycService,
  ) {}

  @Get()
  @Permissions('affiliates.read')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('kycStatus') kycStatus?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.registrationService.listForAdmin({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      kycStatus,
      search,
    });
    return {
      success: true,
      message: 'Affiliates fetched successfully',
      data,
    };
  }

  @Get(':affiliateId')
  @Permissions('affiliates.read')
  async get(@Param('affiliateId') affiliateId: string) {
    const data = await this.registrationService.getForAdmin(affiliateId);
    return {
      success: true,
      message: 'Affiliate fetched successfully',
      data,
    };
  }

  @Patch(':affiliateId/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.approve')
  // Phase 157 — @Idempotent so a double-click / retry returns the first result
  // instead of a "already active" 400; @Throttle as a coarse abuse cap.
  // (@Roles('SUPER_ADMIN') intentionally NOT added — approval is a lower-stakes,
  // permission-gated action, not a money transfer; see report.)
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async approve(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
  ) {
    const adminId = (req as any).adminId;
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.approve(
      affiliateId,
      adminId,
      {
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      },
    );
    return {
      success: true,
      message: 'Affiliate approved. A primary coupon code has been generated.',
      data,
    };
  }

  @Patch(':affiliateId/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.approve')
  async reject(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: RejectAffiliateDto,
  ) {
    const adminId = (req as any).adminId;
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.reject(
      affiliateId,
      dto.reason,
      adminId,
      {
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      },
    );
    return {
      success: true,
      message: 'Affiliate rejected.',
      data,
    };
  }

  @Patch(':affiliateId/suspend')
  @HttpCode(HttpStatus.OK)
  // Phase 159h — @Idempotent so a double-click can't double-process; @Throttle
  // as a coarse abuse cap on a money-affecting state change.
  @Permissions('affiliates.suspend')
  @Idempotent()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async suspend(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: SuspendAffiliateDto,
  ) {
    const adminId = (req as any).adminId;
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.suspend(
      affiliateId,
      dto.reason,
      adminId,
      {
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      },
    );
    return {
      success: true,
      message: 'Affiliate suspended.',
      data,
    };
  }

  @Patch(':affiliateId/deactivate')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.suspend')
  @Idempotent()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async deactivate(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
  ) {
    const adminId = (req as any).adminId;
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.deactivate(
      affiliateId,
      adminId,
      {
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      },
    );
    return {
      success: true,
      message: 'Affiliate deactivated.',
      data,
    };
  }

  @Patch(':affiliateId/reactivate')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.suspend')
  @Idempotent()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reactivate(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: ReactivateAffiliateDto,
  ) {
    const adminId = (req as any).adminId;
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.reactivate(
      affiliateId,
      adminId,
      dto.reason,
      {
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      },
    );
    return {
      success: true,
      message: 'Affiliate reactivated.',
      data,
    };
  }

  // ── KYC ─────────────────────────────────────────────────────
  // KYC review endpoints temporarily disabled (commented out per
  // product request). Service + DTOs preserved — restore the block
  // below to re-enable.
  /*
  @Get(':affiliateId/kyc')
  @Permissions('affiliates.read')
  async getKyc(@Param('affiliateId') affiliateId: string) {
    const data = await this.kycService.getForAdmin(affiliateId);
    return {
      success: true,
      message: data ? 'KYC fetched successfully' : 'No KYC submission yet',
      data,
    };
  }

  @Patch(':affiliateId/kyc/verify')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.approve')
  async verifyKyc(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.kycService.verify({ affiliateId, adminId });
    return {
      success: true,
      message: 'KYC verified. Affiliate is now eligible for payouts.',
      data,
    };
  }

  @Patch(':affiliateId/kyc/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('affiliates.approve')
  async rejectKyc(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: RejectAffiliateKycDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.kycService.reject({
      affiliateId,
      adminId,
      reason: dto.reason,
    });
    return {
      success: true,
      message: 'KYC rejected. The affiliate can re-submit with corrected details.',
      data,
    };
  }
  */

  // ── Per-affiliate commission rate ──────────────────────────

  @Patch(':affiliateId/commission')
  @HttpCode(HttpStatus.OK)
  // Phase 159 — commission rate sets the % an affiliate earns on ALL future
  // orders; a malicious 100% override is direct money loss. Gate it like the
  // strongest affiliate money action (payout mark-paid): SUPER_ADMIN only,
  // on top of the granular permission. @Idempotent makes a double-submit a
  // safe replay; @Throttle is a coarse abuse cap. (If finance delegation is
  // wanted later, add 'FINANCE_ADMIN' to @Roles.)
  @Roles('SUPER_ADMIN')
  @Permissions('affiliates.commission')
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async updateCommissionRate(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: UpdateCommissionRateDto,
  ) {
    const adminId = (req as any).adminId;
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.updateCommissionRate({
      affiliateId,
      percentage: dto.percentage,
      adminId,
      reason: dto.reason,
      audit: {
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      },
    });
    return {
      success: true,
      message:
        dto.percentage == null
          ? 'Commission override cleared. Affiliate will use the platform default.'
          : `Commission rate set to ${dto.percentage}%.`,
      data,
    };
  }

  // ── Additional coupon codes (campaign codes) ──────────────

  @Post(':affiliateId/coupons')
  @HttpCode(HttpStatus.CREATED)
  // Phase 159b — dedicated create permission (distinct from approve/configure).
  // @Idempotent so a double-submit replays the first create; @Throttle caps
  // scripted/erroneous bulk creation (the per-affiliate cap is the hard limit).
  @Permissions('affiliates.coupons.create')
  @Idempotent()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async createCoupon(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: CreateAdditionalCouponDto,
  ) {
    const adminId = (req as any).adminId;
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.createAdditionalCoupon({
      affiliateId,
      code: dto.code,
      customerDiscountType: dto.customerDiscountType ?? null,
      customerDiscountValue: dto.customerDiscountValue ?? null,
      maxDiscountAmount: dto.maxDiscountAmount ?? null,
      minOrderValue: dto.minOrderValue ?? null,
      maxUses: dto.maxUses ?? null,
      perUserLimit: dto.perUserLimit,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      isPrimary: dto.isPrimary,
      adminId,
      audit: {
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      },
    });
    return {
      success: true,
      message: 'Coupon created.',
      data,
    };
  }

  // ── Per-coupon configuration (discount, expiry, caps) ──────

  @Patch(':affiliateId/coupons/:couponId')
  @HttpCode(HttpStatus.OK)
  // Phase 158 — dedicated permission (audit #11). Coupon config moves
  // customer-facing money, so it warrants a narrower grant than the broad
  // 'affiliates.commission'. @Idempotent makes a double-submit a safe no-op;
  // @Throttle is a coarse abuse cap on a money-affecting mutation.
  @Permissions('affiliates.coupons.configure')
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async updateCouponConfig(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Param('couponId') couponId: string,
    @Body() body: UpdateCouponConfigDto,
  ) {
    const adminId = (req as any).adminId;
    const userAgent = req.headers['user-agent'];
    const data = await this.registrationService.updateCouponConfig({
      affiliateId,
      couponId,
      isActive: body.isActive,
      customerDiscountType: body.customerDiscountType,
      customerDiscountValue: body.customerDiscountValue,
      maxDiscountAmount: body.maxDiscountAmount,
      startsAt:
        body.startsAt === undefined
          ? undefined
          : body.startsAt === null
          ? null
          : new Date(body.startsAt),
      expiresAt:
        body.expiresAt === undefined
          ? undefined
          : body.expiresAt === null
          ? null
          : new Date(body.expiresAt),
      maxUses: body.maxUses,
      perUserLimit: body.perUserLimit,
      minOrderValue: body.minOrderValue,
      // Finding #13 — provenance reason recorded on the row when this
      // update deactivates (revokes) the coupon.
      revocationReason: body.revocationReason,
      adminId,
      audit: {
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      },
    });
    return {
      success: true,
      message: 'Coupon updated.',
      data,
    };
  }
}
