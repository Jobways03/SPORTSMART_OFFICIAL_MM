import { Public } from '@core/decorators';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SellerRegisterDto } from '../dtos/seller-register.dto';
import { SellerVerifyEmailDto } from '../dtos/seller-verify-email.dto';
import { SellerResendVerificationOtpDto } from '../dtos/seller-resend-verification-otp.dto';
import { RegisterSellerUseCase } from '../../application/use-cases/register-seller.use-case';
import { PublicVerifySellerEmailUseCase } from '../../application/use-cases/public-verify-seller-email.use-case';
import { ResendSellerVerificationOtpUseCase } from '../../application/use-cases/resend-seller-verification-otp.use-case';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';

/**
 * Phase 18 (2026-05-20) — Seller registration + verification controller.
 *
 * Three endpoints, all unauthenticated, all rate-limited, all
 * CAPTCHA-protected:
 *
 *   POST /seller/auth/register                    3/min/IP
 *   POST /seller/auth/verify-email                5/min/IP
 *   POST /seller/auth/resend-verification-otp     1/min/IP
 *
 * sellerType is derived SERVER-SIDE from the `X-Seller-Type` header
 * that each portal's api-client bakes in. The header is asserted
 * against a small allow-list so a malicious client can't override
 * the field by sending arbitrary header values — it must be
 * literally `D2C` or `RETAIL`. The audit's "D2C portal can submit
 * sellerType: RETAIL" gap is closed: the DTO no longer accepts the
 * field at all, and the header value is the only input the
 * controller trusts.
 */
@ApiTags('Seller Auth')
@Public()
@Controller('seller/auth')
export class SellerRegisterController {
  constructor(
    private readonly registerSellerUseCase: RegisterSellerUseCase,
    private readonly verifyEmailUseCase: PublicVerifySellerEmailUseCase,
    private readonly resendVerificationOtpUseCase: ResendSellerVerificationOtpUseCase,
    private readonly captcha: CaptchaVerifierService,
  ) {}

  /**
   * Parse and validate the X-Seller-Type header. Strictly literal:
   * "D2C" or "RETAIL" only. Anything else throws 400. Defaulting to
   * D2C silently was the audit's exact concern; explicit rejection
   * means a misconfigured client can't silently fall through.
   */
  private deriveSellerType(header: string | string[] | undefined): 'D2C' | 'RETAIL' {
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) {
      throw new BadRequestException(
        'Missing X-Seller-Type header. Each seller portal must declare D2C or RETAIL via this header.',
      );
    }
    const trimmed = raw.trim().toUpperCase();
    if (trimmed !== 'D2C' && trimmed !== 'RETAIL') {
      throw new BadRequestException(
        'Invalid X-Seller-Type header. Allowed values: D2C, RETAIL.',
      );
    }
    return trimmed;
  }

  @Post('register')
  // 7 registrations / 60s / IP — a humane limit so a genuine user who fumbles
  // the form a few times (typo'd email/phone, password rules) isn't blocked
  // before a valid submission, while still defeating signup flooding.
  @Throttle({ default: { limit: 7, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async register(
    @Body() dto: SellerRegisterDto,
    @Headers('x-seller-type') sellerTypeHeader: string | undefined,
    @Ip() ip: string,
  ) {
    // CAPTCHA verified BEFORE bcrypt-cost-12 inside the use case.
    await this.captcha.verify(dto.captchaToken, ip);

    const sellerType = this.deriveSellerType(sellerTypeHeader);

    const data = await this.registerSellerUseCase.execute({
      sellerName: dto.sellerName,
      sellerShopName: dto.sellerShopName,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      password: dto.password,
      confirmPassword: dto.confirmPassword,
      acceptTerms: dto.acceptTerms,
      acceptPrivacy: dto.acceptPrivacy,
      acceptMarketing: dto.acceptMarketing,
      sellerType,
    });

    return {
      success: true,
      message: data.message,
      data,
    };
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: SellerVerifyEmailDto, @Ip() ip: string) {
    await this.captcha.verify(dto.captchaToken, ip);
    const data = await this.verifyEmailUseCase.execute({
      email: dto.email,
      otp: dto.otp,
    });
    return {
      success: true,
      message: 'Email verified. Please sign in to continue.',
      data,
    };
  }

  @Post('resend-verification-otp')
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async resendVerificationOtp(
    @Body() dto: SellerResendVerificationOtpDto,
    @Ip() ip: string,
  ) {
    await this.captcha.verify(dto.captchaToken, ip);
    const data = await this.resendVerificationOtpUseCase.execute({
      email: dto.email,
    });
    return {
      success: true,
      message: data.message,
      data,
    };
  }
}
