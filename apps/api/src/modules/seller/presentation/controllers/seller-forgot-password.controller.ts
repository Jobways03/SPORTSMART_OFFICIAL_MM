import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SellerForgotPasswordDto } from '../dtos/seller-forgot-password.dto';
import { SellerVerifyResetOtpDto } from '../dtos/seller-verify-reset-otp.dto';
import { SellerResendResetOtpDto } from '../dtos/seller-resend-reset-otp.dto';
import { ForgotPasswordSellerUseCase } from '../../application/use-cases/forgot-password-seller.use-case';
import { VerifyResetOtpSellerUseCase } from '../../application/use-cases/verify-reset-otp-seller.use-case';
import { ResendResetOtpSellerUseCase } from '../../application/use-cases/resend-reset-otp-seller.use-case';

@Controller('seller/auth')
export class SellerForgotPasswordController {
  constructor(
    private readonly forgotPasswordUseCase: ForgotPasswordSellerUseCase,
    private readonly verifyResetOtpUseCase: VerifyResetOtpSellerUseCase,
    private readonly resendResetOtpUseCase: ResendResetOtpSellerUseCase,
  ) {}

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: SellerForgotPasswordDto) {
    await this.forgotPasswordUseCase.execute({ email: dto.email });

    return {
      success: true,
      message: 'If an account with that email exists, a password reset OTP has been sent.',
    };
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  async verifyResetOtp(@Body() dto: SellerVerifyResetOtpDto) {
    const result = await this.verifyResetOtpUseCase.execute({
      email: dto.email,
      otp: dto.otp,
    });

    return {
      success: true,
      message: 'OTP verified successfully',
      data: result,
    };
  }

  @Post('resend-reset-otp')
  @HttpCode(HttpStatus.OK)
  async resendResetOtp(@Body() dto: SellerResendResetOtpDto) {
    await this.resendResetOtpUseCase.execute({ email: dto.email });

    return {
      success: true,
      message: 'If an account with that email exists, a new OTP has been sent.',
    };
  }
}
