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
import { LoginDto } from '../dtos/login.dto';
import { LoginUserUseCase } from '../../application/use-cases/login-user.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { setAuthCookies } from '../../../../core/auth/auth-cookie.helper';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';

@ApiTags('Auth')
@Controller('auth')
export class LoginController {
  constructor(
    private readonly loginUseCase: LoginUserUseCase,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
    private readonly captcha: CaptchaVerifierService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Per-IP burst limit. Combined with the per-account lockout
  // (5 wrong → 15-min lock) and the per-email Redis soft-lock (10
  // wrong across IP rotation in 15 min → 15-min soft-lock), this
  // covers the three credential-stuffing patterns: single-IP burst,
  // single-account brute, distributed multi-account probe.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const ipAddress = ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Phase 17 (2026-05-20) — verify the captcha BEFORE invoking the
    // use case. The use case runs bcrypt cost-12; we never want to
    // pay that for a request that hasn't proved it's a real browser.
    // CaptchaVerifierService throws BadRequestAppException on
    // missing/invalid token; the global filter maps that to a 400
    // with a CAPTCHA_FAILED / CAPTCHA_REQUIRED code.
    await this.captcha.verify(dto.captchaToken, ipAddress);

    try {
      const data = await this.loginUseCase.execute({
        email: dto.email,
        password: dto.password,
        userAgent,
        ipAddress,
      });

      // Mirror the tokens into httpOnly cookies. The JSON body still
      // carries them so legacy frontends keep working during the
      // sessionStorage → cookie migration soak.
      const accessToken = (data as { accessToken?: string })?.accessToken;
      const refreshToken = (data as { refreshToken?: string })?.refreshToken;
      if (accessToken && refreshToken) {
        setAuthCookies(res, {
          persona: 'customer',
          accessToken,
          refreshToken,
          // Phase 259 — match the access COOKIE lifetime to the access TOKEN
          // TTL (data.expiresIn). Without this the cookie defaulted to 1h while
          // the JWT lives JWT_ACCESS_TTL (1d), so the browser dropped the access
          // cookie after 1h and a page refresh logged the customer out.
          accessTtlSeconds: (data as { expiresIn?: number })?.expiresIn,
          domain: this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
          secure:
            this.env.isProduction() ||
            this.env.getString('NODE_ENV') === 'staging',
        });
      }

      // Best-effort: attribute the LOGIN_SUCCESS to the user that just
      // authenticated. The use-case returns at minimum a user.id;
      // failures here must not block the login response.
      const actorId = (data as any)?.user?.userId ?? (data as any)?.userId;
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
      // Email-based attribution: failed logins record the email as
      // the pseudo-actorId so admins can spot brute-force patterns
      // even without a matched user.
      this.accessLog
        .record({
          actorType: 'CUSTOMER',
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
}
