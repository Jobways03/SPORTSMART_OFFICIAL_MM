import { Public } from '@core/decorators';
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class ResetPasswordController {
  constructor(
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
    private readonly accessLog: AccessLogService,
  ) {}

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Req() req: Request, @Body() dto: ResetPasswordDto) {
    const result = await this.resetPasswordUseCase.execute({
      resetToken: dto.resetToken,
      newPassword: dto.newPassword,
    });

    // Best-effort audit. The use case may return the user id; if not,
    // attribute by reset-token (still useful for forensic timeline).
    const actorId =
      (result as any)?.userId ?? (result as any)?.user?.id ?? `token:${dto.resetToken.slice(0, 8)}`;
    this.accessLog
      .record({
        actorType: 'CUSTOMER',
        actorId,
        kind: 'PASSWORD_RESET',
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    };
  }
}
