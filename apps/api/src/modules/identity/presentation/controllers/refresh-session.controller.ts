import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

@ApiTags('Auth')
@Controller('auth')
export class RefreshSessionController {
  constructor(
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
    private readonly accessLog: AccessLogService,
  ) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Body() body: { refreshToken: string }) {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await this.refreshSessionUseCase.execute({
      refreshToken: body.refreshToken,
    });

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
