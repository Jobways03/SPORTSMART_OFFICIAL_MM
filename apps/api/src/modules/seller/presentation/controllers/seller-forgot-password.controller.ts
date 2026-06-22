import { Public } from '@core/decorators';
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { SellerForgotPasswordDto } from '../dtos/seller-forgot-password.dto';
import { SellerVerifyResetOtpDto } from '../dtos/seller-verify-reset-otp.dto';
import { SellerResendResetOtpDto } from '../dtos/seller-resend-reset-otp.dto';
import { ForgotPasswordSellerUseCase } from '../../application/use-cases/forgot-password-seller.use-case';
import { VerifyResetOtpSellerUseCase } from '../../application/use-cases/verify-reset-otp-seller.use-case';
import { ResendResetOtpSellerUseCase } from '../../application/use-cases/resend-reset-otp-seller.use-case';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';

@ApiTags('Seller Auth')
@Public()
@Controller('seller/auth')
export class SellerForgotPasswordController {
  constructor(
    private readonly forgotPasswordUseCase: ForgotPasswordSellerUseCase,
    private readonly verifyResetOtpUseCase: VerifyResetOtpSellerUseCase,
    private readonly resendResetOtpUseCase: ResendResetOtpSellerUseCase,
    private readonly captcha: CaptchaVerifierService,
  ) {}

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(
    @Body() dto: SellerForgotPasswordDto,
    @Req() req: Request,
  ) {
    // Phase 21 (2026-05-20) — captcha before the use-case so a
    // scripted attacker can't enumerate by burning the OTP cooldown.
    await this.captcha.verify(dto.captchaToken, req.ip);
    await this.forgotPasswordUseCase.execute({ email: dto.email });

    return {
      success: true,
      message: 'If an account with that email exists, a password reset OTP has been sent.',
    };
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resendResetOtp(@Body() dto: SellerResendResetOtpDto) {
    await this.resendResetOtpUseCase.execute({ email: dto.email });

    return {
      success: true,
      message: 'If an account with that email exists, a new OTP has been sent.',
    };
  }
}
