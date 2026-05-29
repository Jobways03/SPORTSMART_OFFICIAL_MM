import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AffiliateAuthService } from '../../application/services/affiliate-auth.service';
import { AffiliateRefreshSessionService } from '../../application/services/affiliate-refresh-session.service';
import { AffiliatePasswordResetService } from '../../application/services/affiliate-password-reset.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AffiliateAuthGuard } from '../../../../core/guards';
import {
  clearAuthCookies,
  readRefreshCookie,
  setAuthCookies,
} from '../../../../core/auth/auth-cookie.helper';
import { AffiliateLoginDto } from '../dtos/affiliate-login.dto';
import { AffiliateForgotPasswordDto } from '../dtos/affiliate-forgot-password.dto';
import { AffiliateVerifyResetOtpDto } from '../dtos/affiliate-verify-reset-otp.dto';
import { AffiliateResendResetOtpDto } from '../dtos/affiliate-resend-reset-otp.dto';
import { AffiliateResetPasswordDto } from '../dtos/affiliate-reset-password.dto';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';

@ApiTags('Affiliate Auth')
@Controller('affiliate/auth')
export class AffiliateAuthController {
  constructor(
    private readonly authService: AffiliateAuthService,
    private readonly refreshService: AffiliateRefreshSessionService,
    private readonly passwordResetService: AffiliatePasswordResetService,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
    private readonly captcha: CaptchaVerifierService,
    private readonly prisma: PrismaService,
  ) {}

  private cookieSettings() {
    return {
      domain: this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
      secure:
        this.env.isProduction() ||
        this.env.getString('NODE_ENV') === 'staging',
    };
  }

  // Phase 3 (PR 3.4) — per-IP rate limit on login. Defends against
  // credential spray (one attacker IP rotating through many emails)
  // which slips past the per-account `failedLoginAttempts` /
  // `lockUntil` lockout. Matches the throttle on the other four
  // persona login endpoints (customer, admin, seller, franchise).
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: AffiliateLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    // Phase 22 (2026-05-20) — captcha BEFORE bcrypt so credential-spray
    // bots burn cheap captcha checks, not expensive hash compares.
    await this.captcha.verify(dto.captchaToken, ipAddress);
    try {
      const data = await this.authService.login({
        email: dto.email,
        password: dto.password,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
        ipAddress,
      });

      // Follow-up #H40 — mirror tokens to httpOnly cookies.
      const accessToken = (data as { accessToken?: string })?.accessToken;
      const refreshToken = (data as { refreshToken?: string })?.refreshToken;
      if (accessToken && refreshToken) {
        setAuthCookies(res, {
          persona: 'affiliate',
          accessToken,
          refreshToken,
          ...this.cookieSettings(),
        });
      }

      const affiliateId =
        (data as any)?.affiliate?.id ?? (data as any)?.affiliateId;
      if (affiliateId) {
        this.accessLog
          .record({
            actorType: 'AFFILIATE',
            actorId: affiliateId,
            kind: 'LOGIN_SUCCESS',
            ipAddress,
            userAgent,
          })
          .catch(() => undefined);
      }

      return {
        success: true,
        message: 'Login successful',
        data,
      };
    } catch (err) {
      this.accessLog
        .record({
          actorType: 'AFFILIATE',
          actorId: (dto as any)?.email ?? (dto as any)?.identifier ?? 'unknown',
          kind: 'LOGIN_FAILURE',
          ipAddress,
          userAgent,
          succeeded: false,
          reason: (err as Error).message,
        })
        .catch(() => undefined);
      throw err;
    }
  }

  // Follow-up #123 — rotate the refresh token, mint a new short-lived
  // access token. Mirrors POST /admin|seller|franchise/auth/refresh.
  // Throttled identically to login to bound credential-stuffing speed
  // if an attacker brute-forces refresh tokens.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Follow-up #H40 — accept refresh token from body OR cookie.
    const refreshToken =
      body?.refreshToken ?? readRefreshCookie(req, 'affiliate');

    const data = await this.refreshService.refresh(refreshToken ?? '');

    setAuthCookies(res, {
      persona: 'affiliate',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      ...this.cookieSettings(),
    });

    return {
      success: true,
      message: 'Session refreshed',
      data,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(
    @Body() dto: AffiliateForgotPasswordDto,
    @Req() req: Request,
  ) {
    // Phase 22 (2026-05-20) — captcha gate before OTP send so a
    // scripted attacker can't burn the cooldown to enumerate emails.
    await this.captcha.verify(dto.captchaToken, req.ip);
    await this.passwordResetService.forgotPassword(dto.email);
    return {
      success: true,
      message: 'If an account with that email exists, a password reset OTP has been sent.',
    };
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyResetOtp(@Body() dto: AffiliateVerifyResetOtpDto) {
    const data = await this.passwordResetService.verifyOtp(dto.email, dto.otp);
    return {
      success: true,
      message: 'OTP verified successfully',
      data,
    };
  }

  @Post('resend-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resendResetOtp(@Body() dto: AffiliateResendResetOtpDto) {
    await this.passwordResetService.resendOtp(dto.email);
    return {
      success: true,
      message: 'If an account with that email exists, a new OTP has been sent.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: AffiliateResetPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new UnauthorizedAppException('Passwords do not match');
    }
    await this.passwordResetService.resetPassword(dto.resetToken, dto.newPassword);
    return {
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    };
  }

  /**
   * Phase 22 (2026-05-20) — Logout.
   *
   * Default mode revokes ONLY the current session (so an affiliate
   * signed in on desktop + phone doesn't nuke every session when one
   * device logs out). Pass `?all=true` for the "log out of all
   * devices" option. Always clears the sm_access_affiliate +
   * sm_refresh_affiliate cookies on the response — stale cookies in
   * the browser are worse than a noisy log line, so the cookie clear
   * runs in a finally block even if the DB write throws.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AffiliateAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('all') all?: string,
  ) {
    const affiliateId = (req as unknown as { affiliateId?: string }).affiliateId;
    const sessionId = (req as unknown as { sessionId?: string }).sessionId;
    const revokeAll = all === 'true' || all === '1';

    try {
      if (revokeAll && affiliateId) {
        await this.prisma.affiliateSession.updateMany({
          where: { affiliateId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else if (sessionId) {
        await this.prisma.affiliateSession.updateMany({
          where: { id: sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } finally {
      clearAuthCookies(
        res,
        'affiliate',
        this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
      );
    }

    return {
      success: true,
      message: revokeAll
        ? 'Logged out of all devices. Every active session has been revoked.'
        : 'Logged out successfully.',
      data: { revokedAll: revokeAll },
    };
  }

  /**
   * Phase 22 (2026-05-20) — Cookie-validated session probe. Replaces
   * the frontend's sessionStorage-based "am I logged in?" check.
   * Returns only the safe profile fields needed to render the
   * dashboard shell — tokens are deliberately NOT echoed; they live
   * in the httpOnly cookies.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AffiliateAuthGuard)
  async me(@Req() req: Request) {
    const affiliateId = (req as unknown as { affiliateId?: string }).affiliateId;
    if (!affiliateId) {
      throw new UnauthorizedAppException();
    }
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        kycStatus: true,
        kycVerifiedAt: true,
      },
    });
    if (!affiliate) {
      throw new UnauthorizedAppException();
    }
    return {
      success: true,
      message: 'Session valid',
      data: {
        affiliateId: affiliate.id,
        email: affiliate.email,
        firstName: affiliate.firstName,
        lastName: affiliate.lastName,
        phone: affiliate.phone,
        status: affiliate.status,
        kycStatus: affiliate.kycStatus,
        kycVerifiedAt: affiliate.kycVerifiedAt,
      },
    };
  }
}
