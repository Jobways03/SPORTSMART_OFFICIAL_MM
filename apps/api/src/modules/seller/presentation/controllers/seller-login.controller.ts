import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { SellerLoginDto } from '../dtos/seller-login.dto';
import { LoginSellerUseCase } from '../../application/use-cases/login-seller.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { setAuthCookies } from '../../../../core/auth/auth-cookie.helper';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';

@ApiTags('Seller Auth')
@Controller('seller/auth')
export class SellerLoginController {
  constructor(
    private readonly loginSellerUseCase: LoginSellerUseCase,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
    private readonly captcha: CaptchaVerifierService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: SellerLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    // Phase 21 (2026-05-20) — CAPTCHA verification BEFORE bcrypt so
    // scripted credential-stuffing wastes cheap captcha checks, not
    // expensive password hashes.
    await this.captcha.verify(dto.captchaToken, ipAddress);
    try {
      const data = await this.loginSellerUseCase.execute({
        identifier: dto.identifier,
        password: dto.password,
        userAgent,
        ipAddress,
        portalType: dto.portalType,
      });

      // Follow-up #H40 — mirror tokens into httpOnly cookies.
      const accessToken = (data as { accessToken?: string })?.accessToken;
      const refreshToken = (data as { refreshToken?: string })?.refreshToken;
      if (accessToken && refreshToken) {
        setAuthCookies(res, {
          persona: 'seller',
          accessToken,
          refreshToken,
          domain: this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
          secure:
            this.env.isProduction() ||
            this.env.getString('NODE_ENV') === 'staging',
        });
      }

      const sellerId = (data as any)?.seller?.id ?? (data as any)?.sellerId;
      if (sellerId) {
        this.accessLog
          .record({
            actorType: 'SELLER',
            actorId: sellerId,
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
      this.accessLog
        .record({
          actorType: 'SELLER',
          actorId: dto.identifier,
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
