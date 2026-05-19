import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { LoginDto } from '../dtos/login.dto';
import { LoginUserUseCase } from '../../application/use-cases/login-user.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { setAuthCookies } from '../../../../core/auth/auth-cookie.helper';

@ApiTags('Auth')
@Controller('auth')
export class LoginController {
  constructor(
    private readonly loginUseCase: LoginUserUseCase,
    private readonly accessLog: AccessLogService,
    private readonly env: EnvService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    try {
      const data = await this.loginUseCase.execute({
        email: dto.email,
        password: dto.password,
        userAgent,
        ipAddress,
      });

      // Follow-up #H40 — mirror the access + refresh tokens into
      // httpOnly cookies. The JSON body still carries the tokens so
      // pre-migration frontends keep working; the next phase drops
      // the body once every frontend reads from the cookie.
      const accessToken = (data as { accessToken?: string })?.accessToken;
      const refreshToken = (data as { refreshToken?: string })?.refreshToken;
      if (accessToken && refreshToken) {
        setAuthCookies(res, {
          persona: 'customer',
          accessToken,
          refreshToken,
          domain: this.env.getString('AUTH_COOKIE_DOMAIN', '') || null,
          secure:
            this.env.isProduction() ||
            this.env.getString('NODE_ENV') === 'staging',
        });
      }

      // Best-effort: attribute the LOGIN_SUCCESS to the user that just
      // authenticated. The use-case returns at minimum a user.id;
      // failures here must not block the login response.
      const actorId = (data as any)?.user?.id ?? (data as any)?.userId;
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
      // Email-based attribution: failed logins record the email as the
      // pseudo-actorId so admins can see brute-force patterns even
      // without a matched user.
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
