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
import { AffiliateRegistrationService } from '../../application/services/affiliate-registration.service';
import { AffiliateKycService } from '../../application/services/affiliate-kyc.service';
import {
  RejectAffiliateDto,
  SuspendAffiliateDto,
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
@UseGuards(AdminAuthGuard)
export class AdminAffiliateController {
  constructor(
    private readonly registrationService: AffiliateRegistrationService,
    private readonly kycService: AffiliateKycService,
  ) {}

  @Get()
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
  async approve(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.registrationService.approve(affiliateId, adminId);
    return {
      success: true,
      message: 'Affiliate approved. A primary coupon code has been generated.',
      data,
    };
  }

  @Patch(':affiliateId/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: RejectAffiliateDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.registrationService.reject(
      affiliateId,
      dto.reason,
      adminId,
    );
    return {
      success: true,
      message: 'Affiliate rejected.',
      data,
    };
  }

  @Patch(':affiliateId/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: SuspendAffiliateDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.registrationService.suspend(
      affiliateId,
      dto.reason,
      adminId,
    );
    return {
      success: true,
      message: 'Affiliate suspended.',
      data,
    };
  }

  @Patch(':affiliateId/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.registrationService.deactivate(
      affiliateId,
      adminId,
    );
    return {
      success: true,
      message: 'Affiliate deactivated.',
      data,
    };
  }

  @Patch(':affiliateId/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.registrationService.reactivate(
      affiliateId,
      adminId,
    );
    return {
      success: true,
      message: 'Affiliate reactivated.',
      data,
    };
  }

  // ── KYC ─────────────────────────────────────────────────────

  @Get(':affiliateId/kyc')
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

  // ── Per-affiliate commission rate ──────────────────────────

  @Patch(':affiliateId/commission')
  @HttpCode(HttpStatus.OK)
  async updateCommissionRate(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Body() body: { percentage: number | null },
  ) {
    const adminId = (req as any).adminId;
    const data = await this.registrationService.updateCommissionRate({
      affiliateId,
      percentage: body.percentage,
      adminId,
    });
    return {
      success: true,
      message:
        body.percentage == null
          ? 'Commission override cleared. Affiliate will use the platform default.'
          : `Commission rate set to ${body.percentage}%.`,
      data,
    };
  }

  // ── Per-coupon configuration (discount, expiry, caps) ──────

  @Patch(':affiliateId/coupons/:couponId')
  @HttpCode(HttpStatus.OK)
  async updateCouponConfig(
    @Req() req: Request,
    @Param('affiliateId') affiliateId: string,
    @Param('couponId') couponId: string,
    @Body()
    body: {
      isActive?: boolean;
      customerDiscountType?: 'PERCENT' | 'FIXED' | null;
      customerDiscountValue?: number | null;
      expiresAt?: string | null;
      maxUses?: number | null;
      perUserLimit?: number;
      minOrderValue?: number | null;
    },
  ) {
    const adminId = (req as any).adminId;
    const data = await this.registrationService.updateCouponConfig({
      affiliateId,
      couponId,
      isActive: body.isActive,
      customerDiscountType: body.customerDiscountType,
      customerDiscountValue: body.customerDiscountValue,
      expiresAt:
        body.expiresAt === undefined
          ? undefined
          : body.expiresAt === null
          ? null
          : new Date(body.expiresAt),
      maxUses: body.maxUses,
      perUserLimit: body.perUserLimit,
      minOrderValue: body.minOrderValue,
      adminId,
    });
    return {
      success: true,
      message: 'Coupon updated.',
      data,
    };
  }
}
