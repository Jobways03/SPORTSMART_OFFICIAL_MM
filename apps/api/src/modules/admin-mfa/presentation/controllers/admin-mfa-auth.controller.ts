import { Public } from '@core/decorators';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { setAuthCookies } from '../../../../core/auth/auth-cookie.helper';
import { AdminMfaVerifyChallengeUseCase } from '../../application/use-cases/admin-mfa-verify-challenge.use-case';
import { VerifyMfaChallengeDto } from '../dtos/verify-mfa-challenge.dto';
import { RequestMfaEmailOtpDto } from '../dtos/request-mfa-email-otp.dto';
import { VerifyMfaEmailOtpDto } from '../dtos/verify-mfa-email-otp.dto';

/**
 * Phase 10 (PR 10.6) — HTTP surface for the MFA challenge-verify
 * step of the admin login flow.
 *
 *   POST /admin/auth/mfa-verify
 *     Body: { challengeToken, code }
 *     Verifies the challenge JWT (signed by /admin/auth/login),
 *     decrypts the admin's MFA secret, verifies the TOTP code,
 *     and on success mints the actual session token pair.
 *
 * Sits OUTSIDE the AdminAuthGuard: the user isn't authenticated
 * yet — they're mid-login. The protection layer is the challenge
 * token itself (short-lived, aud-restricted JWT signed with
 * JWT_ADMIN_SECRET, so an attacker without the password can't
 * forge one) plus the TOTP code (out-of-band second factor).
 *
 * Throttled to match the login endpoint's per-IP rate limit
 * (5/min) so a wrong-code brute-force is bounded even without
 * the anti-replay defence that lands in PR 10.7.
 *
 * Phase 26 (2026-05-20) — parity with the non-MFA login path: on
 * success we now ALSO write the httpOnly cookies (sm_access_admin
 * + sm_refresh_admin). Pre-Phase-26 only the JSON body carried the
 * tokens, so MFA-enrolled admins could not survive a cookie-only
 * frontend migration; the body-only return forced sessionStorage
 * usage even after the rest of the system moved off it.
 */
@ApiTags('Admin Auth')
@Public()
@Controller('admin/auth')
export class AdminMfaAuthController {
  constructor(
    private readonly verifyUseCase: AdminMfaVerifyChallengeUseCase,
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

  @Post('mfa-verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  // Phase 26 (2026-05-20) — response carries fresh session tokens
  // until the cookie-only migration completes; must never be cached.
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async verifyMfaChallenge(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: VerifyMfaChallengeDto,
  ) {
    const data = await this.verifyUseCase.execute({
      challengeToken: dto.challengeToken,
      code: dto.code,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    // Phase 26 — mirror tokens to httpOnly cookies, matching the
    // shape AdminAuthController.login uses for the non-MFA path.
    // Body-side tokens stay for the pre-migration frontend; once
    // every reader has switched to cookie-only the body can drop
    // them, but the cookie write happens unconditionally on success.
    if (data?.accessToken && data?.refreshToken) {
      setAuthCookies(res, {
        persona: 'admin',
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        ...this.cookieSettings(),
      });
    }

    return {
      success: true,
      message: 'MFA challenge verified; admin session active.',
      data,
    };
  }

  /**
   * Email-OTP MFA alternative — step A: email the admin a 6-digit code.
   * Unauthenticated like mfa-verify; the challenge token is the proof.
   * Throttled to bound email-send abuse (the use case also enforces a
   * per-challenge 60s cooldown).
   */
  @Post('mfa-email/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async requestMfaEmailOtp(
    @Req() req: Request,
    @Body() dto: RequestMfaEmailOtpDto,
  ) {
    const data = await this.verifyUseCase.requestEmailOtp({
      challengeToken: dto.challengeToken,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    return {
      success: true,
      message: 'A 6-digit code has been emailed to you.',
      data,
    };
  }

  /**
   * Email-OTP MFA alternative — step B: verify the emailed code and,
   * on success, mint the session (identical shape + cookies to the
   * TOTP mfa-verify path).
   */
  @Post('mfa-email/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async verifyMfaEmailOtp(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: VerifyMfaEmailOtpDto,
  ) {
    const data = await this.verifyUseCase.verifyEmailOtp({
      challengeToken: dto.challengeToken,
      code: dto.code,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    if (data?.accessToken && data?.refreshToken) {
      setAuthCookies(res, {
        persona: 'admin',
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        ...this.cookieSettings(),
      });
    }

    return {
      success: true,
      message: 'MFA challenge verified; admin session active.',
      data,
    };
  }
}
