import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { LogoutUserUseCase } from '../../application/use-cases/logout-user.use-case';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(UserAuthGuard)
export class LogoutController {
  constructor(private readonly logoutUseCase: LogoutUserUseCase) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request & { userId?: string }) {
    if (!req.userId) {
      throw new UnauthorizedException('Customer session not found');
    }
    await this.logoutUseCase.execute(req.userId);
    return {
      success: true,
      message: 'Logged out. All active sessions for this account have been revoked.',
    };
  }
}
