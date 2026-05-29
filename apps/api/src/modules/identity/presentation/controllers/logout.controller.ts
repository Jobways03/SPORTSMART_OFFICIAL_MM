import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { LogoutUserUseCase } from '../../application/use-cases/logout-user.use-case';
import { clearAuthCookies } from '../../../../core/auth/auth-cookie.helper';
import { EnvService } from '../../../../bootstrap/env/env.service';

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
  ) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request & { userId?: string; sessionId?: string },
    @Res({ passthrough: true }) res: Response,
    @Query('all') all?: string,
  ) {
    if (!req.userId || !req.sessionId) {
      throw new UnauthorizedException('Customer session not found');
    }

    let revokedAll = false;
    try {
      const result = await this.logoutUseCase.execute({
        userId: req.userId,
        sessionId: req.sessionId,
        all: all === 'true' || all === '1',
      });
      revokedAll = result.revokedAll;
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
