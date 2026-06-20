import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminMfaService } from '../../application/services/admin-mfa.service';
import { CompleteMfaEnrollmentDto } from '../dtos/complete-enrollment.dto';

/**
 * Public redemption surface for admin MFA enrolment invites.
 *
 * Deliberately UNGUARDED by AdminAuthGuard — the whole point is that the
 * invitee (e.g. a brand-new SUPER_ADMIN) has no session yet. Authorisation
 * comes from possession of the single-use, short-lived, hashed-in-Redis token
 * minted by AdminMfaInviteController. Both routes are tightly throttled to
 * blunt token-guessing, and the begin response carries the cleartext TOTP
 * secret so it must never be cached.
 */
@ApiTags('Admin MFA')
@Controller('admin/mfa/enroll-invite')
export class AdminMfaInviteRedeemController {
  constructor(private readonly mfaService: AdminMfaService) {}

  @Post(':token/begin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async begin(@Param('token') token: string, @Req() req: Request) {
    const data = await this.mfaService.beginEnrollmentByInvite(token, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      success: true,
      message:
        'Scan the QR / add the setup key to your authenticator app, then submit the 6-digit code to finish.',
      data,
    };
  }

  @Post(':token/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async complete(
    @Param('token') token: string,
    @Body() dto: CompleteMfaEnrollmentDto,
    @Req() req: Request,
  ) {
    const data = await this.mfaService.completeEnrollmentByInvite(
      token,
      dto.code,
      { ipAddress: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null },
    );
    return {
      success: true,
      message:
        'MFA enrolled. Save these backup codes now — each is single-use and shown only once. You can now sign in with your password and a 6-digit code.',
      data,
    };
  }

  // ── Email-OTP enrolment (no authenticator app needed) ──────────────────
  @Post(':token/email/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async emailRequest(@Param('token') token: string, @Req() req: Request) {
    const data = await this.mfaService.requestInviteEmailOtp(token, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      success: true,
      message: 'A 6-digit code has been emailed to you.',
      data,
    };
  }

  @Post(':token/email/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async emailVerify(
    @Param('token') token: string,
    @Body() dto: CompleteMfaEnrollmentDto,
    @Req() req: Request,
  ) {
    const data = await this.mfaService.completeInviteEmailOtp(token, dto.code, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      success: true,
      message:
        'MFA enrolled via email. Save these backup codes now — each is single-use and shown only once. You can now sign in with your password and an emailed code.',
      data,
    };
  }
}
