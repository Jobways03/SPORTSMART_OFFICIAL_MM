import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminLoginDto } from '../dtos/admin-login.dto';
import { AdminLoginUseCase } from '../../application/use-cases/admin-login.use-case';
import { AdminLogoutUseCase } from '../../application/use-cases/admin-logout.use-case';
import { AdminGetMeUseCase } from '../../application/use-cases/admin-get-me.use-case';
import { ForgotAdminPasswordUseCase } from '../../application/use-cases/forgot-admin-password.use-case';
import { VerifyAdminResetOtpUseCase } from '../../application/use-cases/verify-admin-reset-otp.use-case';
import { ResendAdminResetOtpUseCase } from '../../application/use-cases/resend-admin-reset-otp.use-case';
import { ResetAdminPasswordUseCase } from '../../application/use-cases/reset-admin-password.use-case';
import { AdminAuthGuard } from '../../../../core/guards';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly loginUseCase: AdminLoginUseCase,
    private readonly logoutUseCase: AdminLogoutUseCase,
    private readonly getMeUseCase: AdminGetMeUseCase,
    private readonly forgotPasswordUseCase: ForgotAdminPasswordUseCase,
    private readonly verifyResetOtpUseCase: VerifyAdminResetOtpUseCase,
    private readonly resendResetOtpUseCase: ResendAdminResetOtpUseCase,
    private readonly resetPasswordUseCase: ResetAdminPasswordUseCase,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    const data = await this.loginUseCase.execute({
      email: dto.email,
      password: dto.password,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    return {
      success: true,
      message: 'Admin login successful',
      data,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  async logout(@Req() req: Request) {
    const adminId = (req as any).adminId;
    await this.logoutUseCase.execute(adminId);

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  async getMe(@Req() req: Request) {
    const adminId = (req as any).adminId;
    const data = await this.getMeUseCase.execute(adminId);

    return {
      success: true,
      message: 'Admin profile fetched',
      data,
    };
  }

  // ── Password reset flow ──────────────────────────────────────────────
  // All four endpoints are public (no AdminAuthGuard) — they're how an
  // admin recovers from a lost password without already being logged in.
  // The use-cases internally enforce non-enumeration: unknown emails get
  // an identical successful response so attackers can't probe for valid
  // admin accounts.

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() body: { email: string }) {
    await this.forgotPasswordUseCase.execute({ email: body.email });
    return {
      success: true,
      message: 'If an admin account exists for that email, a reset OTP has been sent',
    };
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyResetOtp(@Body() body: { email: string; otp: string }) {
    const data = await this.verifyResetOtpUseCase.execute({
      email: body.email,
      otp: body.otp,
    });
    return {
      success: true,
      message: 'OTP verified',
      data,
    };
  }

  @Post('resend-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resendResetOtp(@Body() body: { email: string }) {
    await this.resendResetOtpUseCase.execute({ email: body.email });
    return {
      success: true,
      message: 'If an admin account exists for that email, a new OTP has been sent',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(
    @Body() body: { resetToken: string; newPassword: string },
  ) {
    await this.resetPasswordUseCase.execute({
      resetToken: body.resetToken,
      newPassword: body.newPassword,
    });
    return {
      success: true,
      message: 'Password reset successfully — please log in with your new password',
    };
  }
}
