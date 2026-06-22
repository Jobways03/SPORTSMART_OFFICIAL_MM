import { Public } from '@core/decorators';
import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  readRefreshCookie,
  setAuthCookies,
} from '../../../../core/auth/auth-cookie.helper';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class RefreshSessionController {
  constructor(
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
  ) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string },
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Follow-up #H40 — accept refresh token from EITHER source. The
    // cookie-based path is preferred (frontend not exposing the
    // refresh token to JS at all); body-based is the legacy path
    // that keeps working until every frontend migrates.
    const refreshToken =
      body?.refreshToken ?? readRefreshCookie(req, 'customer');

    const result = await this.refreshSessionUseCase.execute({
      refreshToken: refreshToken ?? '',
    });

    // Mirror the rotated tokens into fresh cookies. Without this,
    // a cookie-based client would lose its session after the first
    // refresh (the prior refresh cookie is now invalid).
    const accessToken = (result as { accessToken?: string })?.accessToken;
    const newRefreshToken = (result as { refreshToken?: string })?.refreshToken;
    if (accessToken && newRefreshToken) {
      setAuthCookies(res, {
        persona: 'customer',
        accessToken,
        refreshToken: newRefreshToken,
        // Phase 259 — cookie maxAge must match the rotated access token's TTL,
        // else the access cookie expires after the 1h default while the JWT
        // lives 1d (page refresh would log the customer out).
        accessTtlSeconds: (result as { expiresIn?: number })?.expiresIn,
        domain: this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
        secure:
          this.env.isProduction() ||
          this.env.getString('NODE_ENV') === 'staging',
      });
    }

    // Best-effort audit. The use case returns at minimum a user.id;
    // failure to log must not break the refresh response.
    const actorId = (result as any)?.user?.id ?? (result as any)?.userId;
    if (actorId) {
      this.accessLog
        .record({
          actorType: 'CUSTOMER',
          actorId,
          kind: 'TOKEN_REFRESH',
          ipAddress,
          userAgent,
        })
        .catch(() => undefined);
    }

    return {
      success: true,
      message: 'Session refreshed',
      data: result,
    };
  }
}
