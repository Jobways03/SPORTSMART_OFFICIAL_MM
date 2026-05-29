import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SellerAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 21 (2026-05-20) — Seller session probe.
 *
 * GET /seller/auth/me is the cookie-friendly replacement for the
 * seller-portal's sessionStorage-based "am I logged in?" check. The
 * route is guarded by SellerAuthGuard, which validates:
 *
 *   • access JWT signature, algorithm pin, issuer, audience;
 *   • SellerSession row exists, not revoked, not expired;
 *   • Seller row exists and status passes `canLogin()`.
 *
 * Returns ONLY the safe profile fields needed by the seller-portal
 * shell (Sidebar avatar, dashboard onboarding banner, route guards).
 * Tokens are deliberately not echoed — they live in the httpOnly
 * cookies.
 */
@ApiTags('Seller Auth')
@Controller('seller/auth')
@UseGuards(SellerAuthGuard)
export class SellerAuthMeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async me(
    @Req() req: Request & { sellerId?: string; sessionId?: string },
  ) {
    if (!req.sellerId) {
      throw new UnauthorizedException();
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: req.sellerId },
      select: {
        id: true,
        email: true,
        sellerName: true,
        sellerShopName: true,
        phoneNumber: true,
        status: true,
        verificationStatus: true,
        isEmailVerified: true,
        sellerType: true,
      },
    });
    if (!seller) {
      throw new UnauthorizedException();
    }

    return {
      success: true,
      message: 'Session valid',
      data: {
        sellerId: seller.id,
        email: seller.email,
        sellerName: seller.sellerName,
        sellerShopName: seller.sellerShopName,
        phoneNumber: seller.phoneNumber,
        status: seller.status,
        verificationStatus: seller.verificationStatus,
        isEmailVerified: seller.isEmailVerified,
        sellerType: seller.sellerType,
      },
    };
  }
}
