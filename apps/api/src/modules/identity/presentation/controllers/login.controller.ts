import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { LoginDto } from '../dtos/login.dto';
import { LoginUserUseCase } from '../../application/use-cases/login-user.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

@ApiTags('Auth')
@Controller('auth')
export class LoginController {
  constructor(
    private readonly loginUseCase: LoginUserUseCase,
    private readonly accessLog: AccessLogService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    try {
      const data = await this.loginUseCase.execute({
        email: dto.email,
        password: dto.password,
        userAgent,
        ipAddress,
      });

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
