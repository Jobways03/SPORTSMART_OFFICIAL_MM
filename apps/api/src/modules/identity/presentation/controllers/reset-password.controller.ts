import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case';

@Controller('auth')
export class ResetPasswordController {
  constructor(
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
  ) {}

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.resetPasswordUseCase.execute({
      resetToken: dto.resetToken,
      newPassword: dto.newPassword,
    });

    return {
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    };
  }
}
