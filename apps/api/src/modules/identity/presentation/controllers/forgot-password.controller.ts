import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ForgotPasswordDto } from '../dtos/forgot-password.dto';
import { VerifyResetOtpDto } from '../dtos/verify-reset-otp.dto';
import { ResendResetOtpDto } from '../dtos/resend-reset-otp.dto';
import { ForgotPasswordUseCase } from '../../application/use-cases/forgot-password.use-case';
import { VerifyResetOtpUseCase } from '../../application/use-cases/verify-reset-otp.use-case';
import { ResendResetOtpUseCase } from '../../application/use-cases/resend-reset-otp.use-case';

@Controller('auth')
export class ForgotPasswordController {
  constructor(
    private readonly forgotPasswordUseCase: ForgotPasswordUseCase,
    private readonly verifyResetOtpUseCase: VerifyResetOtpUseCase,
    private readonly resendResetOtpUseCase: ResendResetOtpUseCase,
  ) {}

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.forgotPasswordUseCase.execute({ email: dto.email });

    return {
      success: true,
      message: 'If an account with that email exists, a password reset OTP has been sent.',
    };
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
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
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resendResetOtp(@Body() dto: ResendResetOtpDto) {
    await this.resendResetOtpUseCase.execute({ email: dto.email });

    return {
      success: true,
      message: 'If an account with that email exists, a new OTP has been sent.',
    };
  }
}
