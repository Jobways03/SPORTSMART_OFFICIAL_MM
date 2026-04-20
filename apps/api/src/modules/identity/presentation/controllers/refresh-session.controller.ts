import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';

@ApiTags('Auth')
@Controller('auth')
export class RefreshSessionController {
  constructor(private readonly refreshSessionUseCase: RefreshSessionUseCase) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refreshToken: string }) {
    const result = await this.refreshSessionUseCase.execute({
      refreshToken: body.refreshToken,
    });
    return {
      success: true,
      message: 'Session refreshed',
      data: result,
    };
  }
}
