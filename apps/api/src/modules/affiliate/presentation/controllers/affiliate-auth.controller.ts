import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AffiliateAuthService } from '../../application/services/affiliate-auth.service';
import { AffiliatePasswordResetService } from '../../application/services/affiliate-password-reset.service';
import { AffiliateLoginDto } from '../dtos/affiliate-login.dto';
import { AffiliateForgotPasswordDto } from '../dtos/affiliate-forgot-password.dto';
import { AffiliateVerifyResetOtpDto } from '../dtos/affiliate-verify-reset-otp.dto';
import { AffiliateResendResetOtpDto } from '../dtos/affiliate-resend-reset-otp.dto';
import { AffiliateResetPasswordDto } from '../dtos/affiliate-reset-password.dto';
import { UnauthorizedAppException } from '../../../../core/exceptions';

@ApiTags('Affiliate Auth')
@Controller('affiliate/auth')
export class AffiliateAuthController {
  constructor(
    private readonly authService: AffiliateAuthService,
    private readonly passwordResetService: AffiliatePasswordResetService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AffiliateLoginDto) {
    const data = await this.authService.login(dto);
    return {
      success: true,
      message: 'Login successful',
      data,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() dto: AffiliateForgotPasswordDto) {
    await this.passwordResetService.forgotPassword(dto.email);
    return {
      success: true,
      message: 'If an account with that email exists, a password reset OTP has been sent.',
    };
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyResetOtp(@Body() dto: AffiliateVerifyResetOtpDto) {
    const data = await this.passwordResetService.verifyOtp(dto.email, dto.otp);
    return {
      success: true,
      message: 'OTP verified successfully',
      data,
    };
  }

  @Post('resend-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resendResetOtp(@Body() dto: AffiliateResendResetOtpDto) {
    await this.passwordResetService.resendOtp(dto.email);
    return {
      success: true,
      message: 'If an account with that email exists, a new OTP has been sent.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: AffiliateResetPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new UnauthorizedAppException('Passwords do not match');
    }
    await this.passwordResetService.resetPassword(dto.resetToken, dto.newPassword);
    return {
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    };
  }
}
