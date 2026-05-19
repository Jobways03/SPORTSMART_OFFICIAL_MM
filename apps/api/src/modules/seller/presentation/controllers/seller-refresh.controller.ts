import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { RefreshSellerSessionUseCase } from '../../application/use-cases/refresh-seller-session.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  readRefreshCookie,
  setAuthCookies,
} from '../../../../core/auth/auth-cookie.helper';

@ApiTags('Seller Auth')
@Controller('seller/auth')
export class SellerRefreshController {
  constructor(
    private readonly refreshSellerSessionUseCase: RefreshSellerSessionUseCase,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
  ) {}

  // Public route — authentication is implicit in the refresh token itself.
  // Throttle is higher than login because legitimate clients may burst on
  // page load (several requests racing a freshly-expired access token);
  // single-flight refresh on the client side keeps this well under the cap.
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
      body?.refreshToken ?? readRefreshCookie(req, 'seller');

    const data = await this.refreshSellerSessionUseCase.execute({
      refreshToken: refreshToken ?? '',
    });

    const newAccess = (data as { accessToken?: string })?.accessToken;
    const newRefresh = (data as { refreshToken?: string })?.refreshToken;
    if (newAccess && newRefresh) {
      setAuthCookies(res, {
        persona: 'seller',
        accessToken: newAccess,
        refreshToken: newRefresh,
        domain: this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
        secure:
          this.env.isProduction() ||
          this.env.getString('NODE_ENV') === 'staging',
      });
    }

    this.accessLog
      .record({
        actorType: 'SELLER',
        actorId: data.sellerId,
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
}
