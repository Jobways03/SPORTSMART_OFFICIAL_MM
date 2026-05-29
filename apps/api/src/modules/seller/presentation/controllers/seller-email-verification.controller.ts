import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import {
  BlockedWhileImpersonating,
  BlockedWhileImpersonatingGuard,
  SellerAuthGuard,
} from '../../../../core/guards';
import { SendEmailVerificationOtpUseCase } from '../../application/use-cases/send-email-verification-otp.use-case';
import { VerifySellerEmailUseCase } from '../../application/use-cases/verify-seller-email.use-case';

@ApiTags('Seller Auth')
@Controller('seller/profile/verify-email')
// Phase 28 (2026-05-21) — chain includes BlockedWhileImpersonatingGuard
// so the verify-email send-OTP + verify routes refuse impersonation
// tokens. An impersonating admin can't auto-mark the target's email
// as verified — that's the target's own act of consent.
@UseGuards(SellerAuthGuard, BlockedWhileImpersonatingGuard)
export class SellerEmailVerificationController {
  constructor(
    private readonly sendOtpUseCase: SendEmailVerificationOtpUseCase,
    private readonly verifyEmailUseCase: VerifySellerEmailUseCase,
  ) {}

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  // Phase 27 (2026-05-21) — per-IP throttle on the authenticated
  // verify-email path. Auth-gated, so the attacker would already
  // need a valid seller session — but a compromised session token
  // could otherwise spam send-otp at the seller's email address
  // (cooldown limits to 1/60s = 60/hr per account; combined with
  // throttle, the attacker also can't fan out across IPs to bypass
  // the per-account cooldown).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @BlockedWhileImpersonating()
  async sendOtp(
    @Req() req: Request,
  ): Promise<{ success: true; message: string; data: { sent: boolean; retryAfterSeconds?: number } }> {
    const sellerId = (req as any).sellerId;
    const data = await this.sendOtpUseCase.execute(sellerId, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    return {
      success: true,
      message: data.sent
        ? 'Verification OTP sent to your email'
        : "We couldn't deliver the OTP right now. Please try again in a moment.",
      data,
    };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  // Phase 27 — verify-side throttle. The OTP has a 5-attempt hard cap
  // (then self-expires); this overlay throttles per-IP for a
  // distributed brute-force across many seller accounts.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @BlockedWhileImpersonating()
  async verify(
    @Req() req: Request,
    @Body() body: { otp: string },
  ) {
    const sellerId = (req as any).sellerId;
    const data = await this.verifyEmailUseCase.execute({
      sellerId,
      otp: body.otp,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    return {
      success: true,
      message: 'Email verified successfully',
      data,
    };
  }
}
