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
import { FranchiseAuthGuard } from '../../../../core/guards';
import { SendFranchiseEmailVerificationUseCase } from '../../application/use-cases/send-franchise-email-verification.use-case';
import { VerifyFranchiseEmailUseCase } from '../../application/use-cases/verify-franchise-email.use-case';

@ApiTags('Franchise Auth')
@Controller('franchise/profile/verify-email')
@UseGuards(FranchiseAuthGuard)
export class FranchiseEmailVerificationController {
  constructor(
    private readonly sendOtpUseCase: SendFranchiseEmailVerificationUseCase,
    private readonly verifyEmailUseCase: VerifyFranchiseEmailUseCase,
  ) {}

  // Phase 27 (2026-05-21) — endpoint path normalisation. The seller
  // mirror (SellerEmailVerificationController) uses /send-otp + /verify
  // since Phase 18; this controller previously used '' (root) + /confirm
  // which an engineer reading either file would notice as drift.
  // No frontend consumer hits these — web-franchise/.../register/verify
  // calls the PUBLIC /franchise/auth/verify-email endpoint, not the
  // authenticated profile path. Safe to rename.
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async sendOtp(
    @Req() req: Request,
  ): Promise<{ success: true; message: string; data: { sent: boolean; retryAfterSeconds?: number } }> {
    const franchiseId = (req as any).franchiseId;
    const data = await this.sendOtpUseCase.execute(franchiseId, {
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
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verify(
    @Req() req: Request,
    @Body() body: { otp: string },
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.verifyEmailUseCase.execute({
      franchiseId,
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
