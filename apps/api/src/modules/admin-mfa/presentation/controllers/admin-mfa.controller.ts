import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthGuard } from '../../../../core/guards';
import { AdminMfaService } from '../../application/services/admin-mfa.service';
import { CompleteMfaEnrollmentDto } from '../dtos/complete-enrollment.dto';

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
  async beginEnrollment(@Req() req: Request) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    if (!adminId) {
      // Defensive — AdminAuthGuard should have rejected the request
      // already. Surface a clean 401 rather than passing undefined
      // into the service and letting it 404.
      throw new UnauthorizedException('Admin session not found');
    }
    const result = await this.mfaService.beginEnrollment(adminId);
    return {
      success: true,
      message:
        'MFA enrollment started. Scan the otpauth URL with your authenticator app, then POST the 6-digit code to /enroll/complete within the 30-second window.',
      data: result,
    };
  }

  @Post('enroll/complete')
  @HttpCode(HttpStatus.OK)
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
  async stepUp(
    @Req() req: Request,
    @Body() dto: CompleteMfaEnrollmentDto,
  ) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    const sessionId = (req as unknown as { sessionId?: string }).sessionId;
    if (!adminId || !sessionId) {
      throw new UnauthorizedException('Admin session not found');
    }
    await this.mfaService.stepUp(adminId, sessionId, dto.code);
    return {
      success: true,
      message:
        'Step-up verified. Destructive admin actions are unlocked for the configured window (default 5 minutes).',
    };
  }
}
