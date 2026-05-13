import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AffiliateAuthService } from '../../application/services/affiliate-auth.service';
import { AffiliatePasswordResetService } from '../../application/services/affiliate-password-reset.service';
import { AffiliateLoginDto } from '../dtos/affiliate-login.dto';
import { AffiliateForgotPasswordDto } from '../dtos/affiliate-forgot-password.dto';
import { AffiliateVerifyResetOtpDto } from '../dtos/affiliate-verify-reset-otp.dto';
import { AffiliateResendResetOtpDto } from '../dtos/affiliate-resend-reset-otp.dto';
import { AffiliateResetPasswordDto } from '../dtos/affiliate-reset-password.dto';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

@ApiTags('Affiliate Auth')
@Controller('affiliate/auth')
export class AffiliateAuthController {
  constructor(
    private readonly authService: AffiliateAuthService,
    private readonly passwordResetService: AffiliatePasswordResetService,
    private readonly accessLog: AccessLogService,
  ) {}

  // Phase 3 (PR 3.4) — per-IP rate limit on login. Defends against
  // credential spray (one attacker IP rotating through many emails)
  // which slips past the per-account `failedLoginAttempts` /
  // `lockUntil` lockout. Matches the throttle on the other four
  // persona login endpoints (customer, admin, seller, franchise).
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: AffiliateLoginDto, @Req() req: Request) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    try {
      const data = await this.authService.login(dto);

      const affiliateId =
        (data as any)?.affiliate?.id ?? (data as any)?.affiliateId;
      if (affiliateId) {
        this.accessLog
          .record({
            actorType: 'AFFILIATE',
            actorId: affiliateId,
            kind: 'LOGIN_SUCCESS',
            ipAddress,
            userAgent,
          })
          .catch(() => undefined);
      }

      return {
        success: true,
        message: 'Login successful',
        data,
      };
    } catch (err) {
      this.accessLog
        .record({
          actorType: 'AFFILIATE',
          actorId: (dto as any)?.email ?? (dto as any)?.identifier ?? 'unknown',
          kind: 'LOGIN_FAILURE',
          ipAddress,
          userAgent,
          succeeded: false,
          reason: (err as Error).message,
        })
        .catch(() => undefined);
      throw err;
    }
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
