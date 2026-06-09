import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminAuthGuard } from '../../../../core/guards';
import { StepUpGuard } from '../../../../core/step-up/step-up.guard';
import { RequiresStepUp } from '../../../../core/step-up/requires-step-up.decorator';
import { AdminMfaService } from '../../application/services/admin-mfa.service';
import { CompleteMfaEnrollmentDto } from '../dtos/complete-enrollment.dto';
import { StepUpMfaDto } from '../dtos/step-up.dto';

/**
 * Phase 10 (PR 10.5) — HTTP surface for admin MFA enrollment.
 *
 *   POST /admin/mfa/enroll/begin
 *     Generates a fresh TOTP secret, stores it as pending, and
 *     returns the otpauth:// URI ready for QR-code rendering on
 *     the admin frontend. The cleartext secret is included so
 *     the frontend can offer a "can't scan? enter manually"
 *     fallback (the same secret is also embedded in the URI).
 *
 *   POST /admin/mfa/enroll/complete
 *     Body: { code: "<6 digits>" }
 *     Verifies the TOTP code against the pending secret. On
 *     success, commits pending → live and sets mfaEnabledAt.
 *
 * Both endpoints sit behind AdminAuthGuard — only an already-
 * authenticated admin can enroll their own MFA. The adminId comes
 * from req.adminId (populated by the guard on successful auth);
 * the body never carries it so an authenticated admin can't enroll
 * MFA on someone else's account.
 *
 * No new permissions guard: MFA enrollment is intrinsic to the
 * admin's own account. A separate "delete admin / rotate someone
 * else's MFA" path lands later and gets the appropriate
 * @Permissions decorator.
 */
@ApiTags('Admin MFA')
@Controller('admin/mfa')
@UseGuards(AdminAuthGuard)
export class AdminMfaController {
  constructor(private readonly mfaService: AdminMfaService) {}

  @Post('enroll/begin')
  @HttpCode(HttpStatus.OK)
  // Phase 25 (2026-05-20) — throttle parity with /admin/auth/login.
  // The begin response carries the cleartext TOTP secret, so an
  // unthrottled endpoint lets a compromised cookie+CSRF gadget
  // re-pull a fresh enrolment secret rapidly to scout for races.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  // Phase 25 — the cleartext secret in this response must never
  // touch a proxy/browser/service-worker cache.
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async beginEnrollment(@Req() req: Request) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    if (!adminId) {
      // Defensive — AdminAuthGuard should have rejected the request
      // already. Surface a clean 401 rather than passing undefined
      // into the service and letting it 404.
      throw new UnauthorizedException('Admin session not found');
    }
    const result = await this.mfaService.beginEnrollment(adminId, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      success: true,
      message:
        'MFA enrollment started. Scan the otpauth URL with your authenticator app, then POST the 6-digit code to /enroll/complete within the 30-second window.',
      data: result,
    };
  }

  @Post('enroll/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  // Phase 25 — the response carries 10 cleartext backup codes that
  // must never be cached anywhere downstream.
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async completeEnrollment(
    @Req() req: Request,
    @Body() dto: CompleteMfaEnrollmentDto,
  ) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    if (!adminId) {
      throw new UnauthorizedException('Admin session not found');
    }
    // PR 10.9 — completeEnrollment returns 10 cleartext backup codes.
    // Surface them in the response so the frontend can render them
    // with a "save these now" warning. This is the ONLY moment the
    // codes exist in cleartext; the API has no path to re-display
    // them once the response is consumed.
    const { backupCodes } = await this.mfaService.completeEnrollment(
      adminId,
      dto.code,
      { ipAddress: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null },
    );
    return {
      success: true,
      message:
        'MFA enrollment complete. Save these backup codes now — each is single-use and used only when you lose your authenticator device. The API cannot show them again.',
      data: { backupCodes },
    };
  }

  // PR 10.10 — step-up auth endpoint. Elevates the current admin
  // session by stamping `stepUpVerifiedAt = now` after a fresh TOTP
  // verification. The @RequiresStepUp guard on destructive routes
  // checks that stamp.
  //
  // Sits under AdminAuthGuard (inherited from the class @UseGuards)
  // because step-up only makes sense for an already-authenticated
  // session. The session id comes from req.sessionId — the same
  // signal AdminAuthGuard populates for every protected route.
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async stepUp(
    @Req() req: Request,
    // Phase 25 — separate DTO that accepts either a 6-digit TOTP
    // OR a XXXXX-XXXXX backup code. The shared CompleteMfaEnrollmentDto
    // rejected backup codes at the DTO boundary, leaving the service's
    // isBackupCodeFormat dispatch dead.
    @Body() dto: StepUpMfaDto,
  ) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    const sessionId = (req as unknown as { sessionId?: string }).sessionId;
    if (!adminId || !sessionId) {
      throw new UnauthorizedException('Admin session not found');
    }
    const result = await this.mfaService.stepUp(adminId, sessionId, dto.code, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      success: true,
      message:
        'Step-up verified. Destructive admin actions are unlocked for the configured window (default 5 minutes).',
      // Phase 26 (2026-05-20) — surface the verifiedAt + expiresAt so
      // the admin UI can render a "elevated session • N:NN remaining"
      // countdown without a follow-up /status call. usedBackupCode lets
      // the UI nudge "you have N-1 codes left" without a 2nd request.
      data: {
        stepUpVerifiedAt: result.stepUpVerifiedAt.toISOString(),
        stepUpExpiresAt: result.stepUpExpiresAt.toISOString(),
        usedBackupCode: result.usedBackupCode,
      },
    };
  }

  // Email-OTP step-up — step A: email the logged-in admin a 6-digit code that
  // POST /admin/mfa/step-up will then accept (alternative to TOTP/backup). No
  // step-up guard here (this GRANTS step-up); just an authenticated session.
  @Post('step-up/email/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestStepUpEmail(@Req() req: Request) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    const sessionId = (req as unknown as { sessionId?: string }).sessionId;
    if (!adminId || !sessionId) {
      throw new UnauthorizedException('Admin session not found');
    }
    const data = await this.mfaService.requestStepUpEmailOtp(adminId, sessionId, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      success: true,
      message: 'A 6-digit step-up code has been emailed to you.',
      data,
    };
  }

  // Phase 25 (2026-05-20) — MFA status read endpoint. Lets the
  // admin frontend show "MFA: Enabled • N backup codes left" without
  // having to attempt an operation. The /me endpoint deliberately
  // does NOT carry MFA detail, so this is the only client surface.
  @Get('status')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, no-cache, private')
  async status(@Req() req: Request) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    if (!adminId) {
      throw new UnauthorizedException('Admin session not found');
    }
    const data = await this.mfaService.getStatus(adminId);
    return {
      success: true,
      message: 'Admin MFA status',
      data,
    };
  }

  // Phase 25 — disable MFA on the calling admin's own account.
  // Step-up gated: the requester must have passed a fresh TOTP /
  // backup-code step-up within the StepUpGuard window. Clears all
  // MFA columns (secret, pending, enabled-at, backup hashes, last-
  // used step) so a subsequent /enroll/begin starts cleanly.
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  async disable(@Req() req: Request) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    if (!adminId) {
      throw new UnauthorizedException('Admin session not found');
    }
    await this.mfaService.disable(adminId, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      success: true,
      message:
        'MFA has been disabled on your account. Re-enroll via /admin/mfa/enroll/begin to restore protection.',
    };
  }

  // Phase 25 — regenerate the 10 single-use backup codes. The old
  // hash list is overwritten in place; once this responds, the
  // previous codes no longer match. Step-up gated; the new
  // cleartext codes are returned exactly once.
  @Post('backup-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @Header('Cache-Control', 'no-store, no-cache, private')
  @Header('Pragma', 'no-cache')
  async regenerateBackupCodes(@Req() req: Request) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    if (!adminId) {
      throw new UnauthorizedException('Admin session not found');
    }
    const { backupCodes } = await this.mfaService.regenerateBackupCodes(
      adminId,
      { ipAddress: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null },
    );
    return {
      success: true,
      message:
        'New backup codes generated. Save them now — the API cannot show them again. Your previous codes are no longer valid.',
      data: { backupCodes },
    };
  }
}
