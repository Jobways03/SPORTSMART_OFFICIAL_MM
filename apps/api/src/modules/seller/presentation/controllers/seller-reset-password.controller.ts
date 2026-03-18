import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SellerResetPasswordDto } from '../dtos/seller-reset-password.dto';
import { ResetPasswordSellerUseCase } from '../../application/use-cases/reset-password-seller.use-case';
import { UnauthorizedAppException } from '../../../../core/exceptions';

@Controller('seller/auth')
export class SellerResetPasswordController {
  constructor(
    private readonly resetPasswordUseCase: ResetPasswordSellerUseCase,
  ) {}

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: SellerResetPasswordDto) {
    // Confirm password match check (application-level, not DTO-level)
    if (dto.newPassword !== dto.confirmPassword) {
      throw new UnauthorizedAppException('Passwords do not match');
    }

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
