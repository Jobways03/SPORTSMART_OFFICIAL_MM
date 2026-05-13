import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminMfaVerifyChallengeUseCase } from '../../application/use-cases/admin-mfa-verify-challenge.use-case';
import { VerifyMfaChallengeDto } from '../dtos/verify-mfa-challenge.dto';

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
 */
@ApiTags('Admin Auth')
@Controller('admin/auth')
export class AdminMfaAuthController {
  constructor(
    private readonly verifyUseCase: AdminMfaVerifyChallengeUseCase,
  ) {}

  @Post('mfa-verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyMfaChallenge(
    @Req() req: Request,
    @Body() dto: VerifyMfaChallengeDto,
  ) {
    const data = await this.verifyUseCase.execute({
      challengeToken: dto.challengeToken,
      code: dto.code,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    return {
      success: true,
      message: 'MFA challenge verified; admin session active.',
      data,
    };
  }
}
