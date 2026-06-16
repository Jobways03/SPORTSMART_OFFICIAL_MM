import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
  AdminForgotPasswordDto,
  AdminLoginDto,
  AdminResendResetOtpDto,
  AdminResetPasswordDto,
  AdminVerifyResetOtpDto,
} from '../dtos/admin-login.dto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';
import {
  clearAuthCookies,
  readRefreshCookie,
  setAuthCookies,
} from '../../../../core/auth/auth-cookie.helper';
import { AdminLoginUseCase } from '../../application/use-cases/admin-login.use-case';
import { AdminLogoutUseCase } from '../../application/use-cases/admin-logout.use-case';
import { AdminGetMeUseCase } from '../../application/use-cases/admin-get-me.use-case';
import { RefreshAdminSessionUseCase } from '../../application/use-cases/refresh-admin-session.use-case';
import { ForgotAdminPasswordUseCase } from '../../application/use-cases/forgot-admin-password.use-case';
import { VerifyAdminResetOtpUseCase } from '../../application/use-cases/verify-admin-reset-otp.use-case';
import { ResendAdminResetOtpUseCase } from '../../application/use-cases/resend-admin-reset-otp.use-case';
import { ResetAdminPasswordUseCase } from '../../application/use-cases/reset-admin-password.use-case';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

@ApiTags('Admin Auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly loginUseCase: AdminLoginUseCase,
    private readonly logoutUseCase: AdminLogoutUseCase,
    private readonly getMeUseCase: AdminGetMeUseCase,
    private readonly refreshSessionUseCase: RefreshAdminSessionUseCase,
    private readonly forgotPasswordUseCase: ForgotAdminPasswordUseCase,
    private readonly verifyResetOtpUseCase: VerifyAdminResetOtpUseCase,
    private readonly resendResetOtpUseCase: ResendAdminResetOtpUseCase,
    private readonly resetPasswordUseCase: ResetAdminPasswordUseCase,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
    private readonly captcha: CaptchaVerifierService,
  ) {}

  private cookieSettings() {
    return {
      domain: this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
      secure:
        this.env.isProduction() ||
        this.env.getString('NODE_ENV') === 'staging',
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    // Phase 23 (2026-05-20) — CAPTCHA verified BEFORE bcrypt. Admin is
    // the highest-value attack surface; a credential-spray bot
    // previously had only the 5/60s per-IP throttle to overcome.
    await this.captcha.verify(dto.captchaToken, ipAddress);
    try {
      const data = await this.loginUseCase.execute({
        email: dto.email,
        password: dto.password,
        userAgent,
        ipAddress,
        portalType: dto.portalType,
      });

      // Follow-up #H40 — mirror tokens to httpOnly cookies; body still
      // carries them for the pre-migration admin frontends.
      const accessToken = (data as { accessToken?: string })?.accessToken;
      const refreshToken = (data as { refreshToken?: string })?.refreshToken;
      if (accessToken && refreshToken) {
        setAuthCookies(res, {
          persona: 'admin',
          accessToken,
          refreshToken,
          ...this.cookieSettings(),
        });
      }

      const adminId =
        (data as any)?.admin?.adminId ??
        (data as any)?.admin?.id ??
        (data as any)?.adminId;
      const adminRole = (data as any)?.admin?.role ?? null;
      // Phase 26 (2026-05-20) — discriminate. The login response is
      // either a real session (mfaRequired absent / false) or a
      // challenge-only halt (mfaRequired: true). Pre-Phase-26 BOTH
      // wrote LOGIN_SUCCESS to the access_log table, which made
      // login-success metrics over-count and confused incident
      // response ("admin X logged in" rows that weren't really
      // logins). The challenge-only case is already recorded in the
      // unified AuditLog as ADMIN_LOGIN_MFA_CHALLENGE_ISSUED (see
      // AdminLoginUseCase.auditLogin); we don't need to redundantly
      // double-write to access_log under a misleading kind.
      const isChallengeOnly = (data as any)?.mfaRequired === true;
      if (adminId && !isChallengeOnly) {
        this.accessLog
          .record({
            actorType: 'ADMIN',
            actorId: adminId,
            actorRole: adminRole,
            kind: 'LOGIN_SUCCESS',
            ipAddress,
            userAgent,
          })
          .catch(() => undefined);
      }

      return {
        success: true,
        message: 'Admin login successful',
        data,
      };
    } catch (err) {
      this.accessLog
        .record({
          actorType: 'ADMIN',
          actorId: dto.email,
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

  // Public route — the access token is already expired by the time the
  // client hits this. Authentication is implicit: only a valid refresh
  // token whose session row is alive can produce a new access token.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    // Follow-up #H40 — accept refresh token from body OR cookie.
    const refreshToken =
      body?.refreshToken ?? readRefreshCookie(req, 'admin');

    const data = await this.refreshSessionUseCase.execute({
      refreshToken: refreshToken ?? '',
    });

    const newAccess = (data as { accessToken?: string })?.accessToken;
    const newRefresh = (data as { refreshToken?: string })?.refreshToken;
    if (newAccess && newRefresh) {
      setAuthCookies(res, {
        persona: 'admin',
        accessToken: newAccess,
        refreshToken: newRefresh,
        ...this.cookieSettings(),
      });
    }

    this.accessLog
      .record({
        actorType: 'ADMIN',
        actorId: data.adminId,
        actorRole: data.role,
        kind: 'TOKEN_REFRESH',
        ipAddress,
        userAgent,
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Session refreshed',
      data,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  // Phase 24 (2026-05-20) — dropped PermissionsGuard from logout.
  // Self-service logout doesn't need a permission gate; AdminAuthGuard
  // already proves the requester owns the session being revoked. The
  // previous wiring (AdminAuthGuard + PermissionsGuard with no
  // @Permissions decorator) effectively bypassed the guard anyway —
  // it just produced an authz audit row tagged with empty
  // requiredPermissions, which is noise.
  @UseGuards(AdminAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const adminId = (req as any).adminId;
    const adminRole = (req as any).adminRole ?? null;
    await this.logoutUseCase.execute(adminId);

    // Follow-up #H40 — clear auth cookies on the way out. The session
    // is already revoked in the use case; this prevents a stale
    // browser-side cookie from being replayed pointlessly until TTL.
    clearAuthCookies(res, 'admin', this.cookieSettings().domain);

    this.accessLog
      .record({
        actorType: 'ADMIN',
        actorId: adminId,
        actorRole: adminRole,
        kind: 'LOGOUT',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Get('me')
  // Phase 24 (2026-05-20) — same rationale as logout: a self-profile
  // probe doesn't need a permission gate; the auth guard already
  // proves the requester owns the row.
  @UseGuards(AdminAuthGuard)
  async getMe(@Req() req: Request) {
    const adminId = (req as any).adminId;
    const data = await this.getMeUseCase.execute(adminId);

    return {
      success: true,
      message: 'Admin profile fetched',
      data,
    };
  }

  // ── Password reset flow ──────────────────────────────────────────────
  // All four endpoints are public (no AdminAuthGuard) — they're how an
  // admin recovers from a lost password without already being logged in.
  // The use-cases internally enforce non-enumeration: unknown emails get
  // an identical successful response so attackers can't probe for valid
  // admin accounts.

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(
    @Body() dto: AdminForgotPasswordDto,
    @Req() req: Request,
  ) {
    // Phase 23 (2026-05-20) — captcha gate before OTP send so scripted
    // attackers can't burn the cooldown to enumerate admin emails.
    await this.captcha.verify(dto.captchaToken, req.ip);
    await this.forgotPasswordUseCase.execute({
      email: dto.email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      success: true,
      message: 'If an admin account exists for that email, a reset OTP has been sent',
    };
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyResetOtp(
    @Body() dto: AdminVerifyResetOtpDto,
    @Req() req: Request,
  ) {
    const data = await this.verifyResetOtpUseCase.execute({
      email: dto.email,
      otp: dto.otp,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      success: true,
      message: 'OTP verified',
      data,
    };
  }

  @Post('resend-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resendResetOtp(@Body() dto: AdminResendResetOtpDto) {
    await this.resendResetOtpUseCase.execute({ email: dto.email });
    return {
      success: true,
      message: 'If an admin account exists for that email, a new OTP has been sent',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(
    @Body() dto: AdminResetPasswordDto,
    @Req() req: Request,
  ) {
    await this.resetPasswordUseCase.execute({
      resetToken: dto.resetToken,
      newPassword: dto.newPassword,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      success: true,
      message: 'Password reset successfully — please log in with your new password',
    };
  }
}
