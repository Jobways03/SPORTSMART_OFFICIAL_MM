import { Public } from '@core/decorators';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { GoogleLoginDto } from '../dtos/google-login.dto';
import { GoogleLoginUseCase } from '../../application/use-cases/google-login.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { setAuthCookies } from '../../../../core/auth/auth-cookie.helper';

/**
 * "Sign in with Google" for storefront customers.
 *
 * Mirrors LoginController exactly: @Public, mounts on /auth, sets the
 * same customer auth cookies, and best-effort records LOGIN_SUCCESS /
 * LOGIN_FAILURE access logs. The raw Google credential is NEVER logged
 * (the failure log attributes a fixed 'google-oauth' pseudo-actor, since
 * there is no trusted email until the token is verified).
 */
@ApiTags('Auth')
@Public()
@Controller('auth')
export class GoogleLoginController {
  constructor(
    private readonly googleLoginUseCase: GoogleLoginUseCase,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
  ) {}

  @Post('google')
  @HttpCode(HttpStatus.OK)
  // Per-IP burst limit, matching the password-login route. The
  // ID-token verify hits Google's JWKS + does crypto work; 5/min/IP
  // bounds abuse without impeding a real user.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async google(
    @Body() dto: GoogleLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const ipAddress = ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    try {
      const data = await this.googleLoginUseCase.execute({
        credential: dto.credential,
        userAgent,
        ipAddress,
      });

      // Mirror the tokens into httpOnly cookies — identical to the
      // password-login controller so the storefront's cookie-based auth
      // works the same regardless of which sign-in method was used.
      if (data.accessToken && data.refreshToken) {
        setAuthCookies(res, {
          persona: 'customer',
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          accessTtlSeconds: data.expiresIn,
          domain: this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
          secure:
            this.env.isProduction() ||
            this.env.getString('NODE_ENV') === 'staging',
        });
      }

      const actorId = data.user?.userId;
      if (actorId) {
        this.accessLog
          .record({
            actorType: 'CUSTOMER',
            actorId,
            kind: 'LOGIN_SUCCESS',
            ipAddress,
            userAgent,
          })
          .catch(() => undefined);
      }

      return {
        success: true,
        message: 'Login successful',
        data,
      };
    } catch (err) {
      // Never log the raw credential. There is no trusted email before
      // verification, so attribute the failure to a fixed pseudo-actor.
      this.accessLog
        .record({
          actorType: 'CUSTOMER',
          actorId: 'google-oauth',
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
}
