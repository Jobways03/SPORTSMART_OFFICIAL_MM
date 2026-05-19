import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AffiliateAuthService } from '../../application/services/affiliate-auth.service';
import { AffiliateRefreshSessionService } from '../../application/services/affiliate-refresh-session.service';
import { AffiliatePasswordResetService } from '../../application/services/affiliate-password-reset.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
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

@ApiTags('Affiliate Auth')
@Controller('affiliate/auth')
export class AffiliateAuthController {
  constructor(
    private readonly authService: AffiliateAuthService,
    private readonly refreshService: AffiliateRefreshSessionService,
    private readonly passwordResetService: AffiliatePasswordResetService,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
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
    try {
      const data = await this.authService.login(dto);

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
  async forgotPassword(@Body() dto: AffiliateForgotPasswordDto) {
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
}
