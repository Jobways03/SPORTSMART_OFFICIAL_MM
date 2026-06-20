import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import type { Request } from 'express';
import { RegisterDto } from '../dtos/register.dto';
import { VerifyEmailOtpDto } from '../dtos/verify-email-otp.dto';
import { ResendVerificationOtpDto } from '../dtos/resend-verification-otp.dto';
import { RegisterUserUseCase } from '../../application/use-cases/register-user.use-case';
import { VerifyEmailOtpUseCase } from '../../application/use-cases/verify-email-otp.use-case';
import { ResendVerificationOtpUseCase } from '../../application/use-cases/resend-verification-otp.use-case';
import { CaptchaVerifierService } from '../../../../integrations/captcha/captcha-verifier.service';

/**
 * Phase 16 (2026-05-20) — Customer registration controller.
 *
 * Three endpoints, all unauthenticated, all rate-limited per IP, all
 * CAPTCHA-protected:
 *
 *   POST /auth/register             3/min/IP — create account + OTP
 *   POST /auth/register/verify-otp  5/min/IP — verify OTP, flip ACTIVE
 *   POST /auth/register/resend-otp  1/min/IP — re-issue OTP (60s cooldown)
 *
 * All three return uniform success payloads so the public API never
 * leaks whether a given email is already registered or in any
 * particular state. The login path is the authoritative check for
 * "is this account verified" (it returns EMAIL_NOT_VERIFIED on
 * PENDING_VERIFICATION rows).
 */
@ApiTags('Auth')
@Controller('auth')
export class RegisterController {
  constructor(
    private readonly registerUseCase: RegisterUserUseCase,
    private readonly verifyEmailOtpUseCase: VerifyEmailOtpUseCase,
    private readonly resendVerificationOtpUseCase: ResendVerificationOtpUseCase,
    private readonly captcha: CaptchaVerifierService,
  ) {}

  @Post('register')
  // 7 registrations / 60s / IP. Humane enough that a genuine user fumbling the
  // form a few times isn't blocked before a valid submission, while still
  // defeating signup flooding + enumeration probes (well under the 300/60s default).
  @Throttle({ default: { limit: 7, ttl: 60_000 } })
  // Phase 21 (2026-05-20) — @Idempotent so a client retrying after a
  // network blip (X-Idempotency-Key replay) gets the cached 202 back
  // instead of paying another bcrypt-cost-12 hash and creating a
  // second OTP. No-op when IDEMPOTENCY_ENABLED=false.
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    await this.captcha.verify(dto.captchaToken, ip);

    const userAgent = req.headers['user-agent'] ?? undefined;
    const data = await this.registerUseCase.execute({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      password: dto.password,
      confirmPassword: dto.confirmPassword,
      acceptTerms: dto.acceptTerms,
      acceptPrivacy: dto.acceptPrivacy,
      acceptMarketing: dto.acceptMarketing,
      ipAddress: ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });

    return {
      success: true,
      message: data.message,
      data,
    };
  }

  @Post('register/verify-otp')
  // 5 verify attempts / 60s / IP. The OTP itself has a 5-attempt
  // hard cap before it self-expires, so this is the IP-level overlay
  // that defeats a distributed brute-force across many accounts.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyEmailOtpDto, @Ip() ip: string) {
    await this.captcha.verify(dto.captchaToken, ip);
    const data = await this.verifyEmailOtpUseCase.execute({
      email: dto.email,
      otp: dto.otp,
    });
    return {
      success: true,
      message: 'Email verified. Your account is now active.',
      data,
    };
  }

  @Post('register/resend-otp')
  // 1 resend / 60s / IP. Combined with the server-side 60-second
  // per-user cooldown, this also defeats the "rotate IP every send"
  // pattern of a botnet.
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() dto: ResendVerificationOtpDto, @Ip() ip: string) {
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
