import {
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { LogoutUserUseCase } from '../../application/use-cases/logout-user.use-case';
import { clearAuthCookies } from '../../../../core/auth/auth-cookie.helper';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

/**
 * Phase 17 (2026-05-20) — Customer logout controller.
 *
 * Two behaviours, picked by the optional `?all=true` query param:
 *
 *   POST /auth/logout           → revoke calling session only
 *   POST /auth/logout?all=true  → revoke every session for this user
 *
 * Both paths:
 *   • require a valid customer session (guarded by UserAuthGuard);
 *   • clear the sm_access_customer + sm_refresh_customer cookies in
 *     the same way they were set — matching the secure / domain
 *     options from setAuthCookies so the browser actually drops them.
 *
 * Cookies are cleared even if the session-revoke DB call fails; the
 * browser-side cleanup is the user-visible part and must not be
 * blocked by transient DB issues.
 */
@ApiTags('Auth')
@Controller('auth')
@UseGuards(UserAuthGuard)
export class LogoutController {
  constructor(
    private readonly logoutUseCase: LogoutUserUseCase,
    private readonly env: EnvService,
    // Phase 201 (#2) — sign-outs were never written to the access log,
    // so the customer's history showed every sign-IN with no matching
    // sign-OUT. The LOGOUT / LOGOUT_ALL_DEVICES enum + UI labels already
    // existed; this controller just never called the writer.
    private readonly accessLog: AccessLogService,
  ) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  // Phase 201 (#4) — 10/min/IP. Logout is a low-frequency user action;
  // the cap stops a loop from flooding the access log with LOGOUT rows.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async logout(
    @Req() req: Request & { userId?: string; sessionId?: string },
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Query('all') all?: string,
  ) {
    if (!req.userId || !req.sessionId) {
      throw new UnauthorizedException('Customer session not found');
    }
    // Capture request context BEFORE revoking — req stays valid through
    // the call, but reading it up front keeps the audit independent of
    // any mutation the revoke path might do to req.
    const userId = req.userId;
    const ipAddress = ip || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] ?? null;

    let revokedAll = false;
    try {
      const result = await this.logoutUseCase.execute({
        userId,
        sessionId: req.sessionId,
        all: all === 'true' || all === '1',
      });
      revokedAll = result.revokedAll;

      // Phase 201 (#2 / #17) — record the sign-out. LOGOUT_ALL_DEVICES
      // for "sign out everywhere," plain LOGOUT for a single device.
      // Best-effort: a failed audit write must never block the logout
      // response (the session is already revoked at this point).
      this.accessLog
        .record({
          actorType: 'CUSTOMER',
          actorId: userId,
          kind: revokedAll ? 'LOGOUT_ALL_DEVICES' : 'LOGOUT',
          ipAddress,
          userAgent,
          metadata: { scope: revokedAll ? 'all_devices' : 'single_session' },
        })
        .catch(() => undefined);
    } finally {
      // Always clear cookies — the user clicked "sign out," they
      // expect the browser to forget them regardless of whether the
      // DB write landed cleanly. The `secure` flag MUST match what
      // setAuthCookies wrote — passing `secure: true` here when the
      // cookie was created with `secure: false` (dev / HTTP localhost)
      // makes Chrome ignore the clear and the user appears logged-in.
      clearAuthCookies(
        res,
        'customer',
        this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
        this.env.isProduction() ||
          this.env.getString('NODE_ENV') === 'staging',
      );
    }

    return {
      success: true,
      message: revokedAll
        ? 'Signed out everywhere. All active sessions have been revoked.'
        : 'Signed out.',
      data: { revokedAll },
    };
  }
}
