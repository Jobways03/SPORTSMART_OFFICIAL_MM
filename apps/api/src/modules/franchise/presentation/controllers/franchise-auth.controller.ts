import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { FranchiseRegisterDto } from '../dtos/franchise-register.dto';
import { FranchiseLoginDto } from '../dtos/franchise-login.dto';
import { FranchiseForgotPasswordDto } from '../dtos/franchise-forgot-password.dto';
import { FranchiseVerifyOtpDto } from '../dtos/franchise-verify-otp.dto';
import { FranchiseResendOtpDto } from '../dtos/franchise-resend-otp.dto';
import { FranchiseResetPasswordDto } from '../dtos/franchise-reset-password.dto';
import { FranchiseChangePasswordDto } from '../dtos/franchise-change-password.dto';
import { RegisterFranchiseUseCase } from '../../application/use-cases/register-franchise.use-case';
import { LoginFranchiseUseCase } from '../../application/use-cases/login-franchise.use-case';
import { ForgotPasswordFranchiseUseCase } from '../../application/use-cases/forgot-password-franchise.use-case';
import { VerifyResetOtpFranchiseUseCase } from '../../application/use-cases/verify-reset-otp-franchise.use-case';
import { ResendResetOtpFranchiseUseCase } from '../../application/use-cases/resend-reset-otp-franchise.use-case';
import { ResetPasswordFranchiseUseCase } from '../../application/use-cases/reset-password-franchise.use-case';
import { ChangePasswordFranchiseUseCase } from '../../application/use-cases/change-password-franchise.use-case';
import { LogoutFranchiseUseCase } from '../../application/use-cases/logout-franchise.use-case';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';

@ApiTags('Franchise Auth')
@Controller('franchise/auth')
export class FranchiseAuthController {
  constructor(
    private readonly registerFranchiseUseCase: RegisterFranchiseUseCase,
    private readonly loginFranchiseUseCase: LoginFranchiseUseCase,
    private readonly forgotPasswordFranchiseUseCase: ForgotPasswordFranchiseUseCase,
    private readonly verifyResetOtpFranchiseUseCase: VerifyResetOtpFranchiseUseCase,
    private readonly resendResetOtpFranchiseUseCase: ResendResetOtpFranchiseUseCase,
    private readonly resetPasswordFranchiseUseCase: ResetPasswordFranchiseUseCase,
    private readonly changePasswordFranchiseUseCase: ChangePasswordFranchiseUseCase,
    private readonly logoutFranchiseUseCase: LogoutFranchiseUseCase,
    private readonly accessLog: AccessLogService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() dto: FranchiseRegisterDto) {
    const data = await this.registerFranchiseUseCase.execute({
      ownerName: dto.ownerName,
      businessName: dto.businessName,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      password: dto.password,
    });

    return {
      success: true,
      message: 'Franchise registered successfully',
      data,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: FranchiseLoginDto, @Req() req: Request) {
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    try {
      const data = await this.loginFranchiseUseCase.execute({
        identifier: dto.identifier,
        password: dto.password,
        userAgent,
        ipAddress,
      });

      const franchiseId = (data as any)?.franchise?.id ?? (data as any)?.franchiseId;
      if (franchiseId) {
        this.accessLog
          .record({
            actorType: 'FRANCHISE',
            actorId: franchiseId,
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
          actorType: 'FRANCHISE',
          actorId: dto.identifier,
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
  async forgotPassword(@Body() dto: FranchiseForgotPasswordDto) {
    await this.forgotPasswordFranchiseUseCase.execute({ email: dto.email });

    return {
      success: true,
      message: 'If an account with that email exists, a password reset OTP has been sent.',
    };
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyResetOtp(@Body() dto: FranchiseVerifyOtpDto) {
    const data = await this.verifyResetOtpFranchiseUseCase.execute({
      email: dto.email,
      otp: dto.otp,
    });

    return {
      success: true,
      message: 'OTP verified successfully',
      data,
    };
  }

  @Post('resend-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resendResetOtp(@Body() dto: FranchiseResendOtpDto) {
    await this.resendResetOtpFranchiseUseCase.execute({ email: dto.email });

    return {
      success: true,
      message: 'If an account with that email exists, a new OTP has been sent.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: FranchiseResetPasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new UnauthorizedAppException('Passwords do not match');
    }

    await this.resetPasswordFranchiseUseCase.execute({
      resetToken: dto.resetToken,
      newPassword: dto.newPassword,
    });

    return {
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    };
  }

  /**
   * Self-service password change for an already-authenticated franchise.
   * Requires current password as proof-of-identity. Parallel to the forgot-
   * password flow, but does not require email OTP.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FranchiseAuthGuard)
  async changePassword(
    @Req() req: Request,
    @Body() dto: FranchiseChangePasswordDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    await this.changePasswordFranchiseUseCase.execute({
      franchiseId,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });

    return {
      success: true,
      message: 'Password changed successfully.',
    };
  }

  /**
   * Server-side logout: revokes every active session for this franchise.
   * The frontend separately clears its local tokens — this endpoint
   * makes sure a stolen refresh token can't be replayed after logout.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FranchiseAuthGuard)
  async logout(@Req() req: Request) {
    const franchiseId = (req as any).franchiseId;
    if (!franchiseId) {
      throw new UnauthorizedAppException('Franchise session not found');
    }
    await this.logoutFranchiseUseCase.execute(franchiseId);
    return {
      success: true,
      message: 'Logged out. All active sessions for this franchise have been revoked.',
    };
  }
}
