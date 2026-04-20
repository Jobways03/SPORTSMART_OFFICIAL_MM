import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface VerifyResetOtpSellerInput {
  email: string;
  otp: string;
}

export interface VerifyResetOtpSellerResult {
  resetToken: string;
}

@Injectable()
export class VerifyResetOtpSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifyResetOtpSellerUseCase');
  }

  async execute(input: VerifyResetOtpSellerInput): Promise<VerifyResetOtpSellerResult> {
    const { email, otp } = input;

    const seller = await this.sellerRepo.findByEmail(email);
    if (!seller) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Find latest unexpired, unused, unverified OTP
    const otpRecord = await this.sellerRepo.findLatestValidOtp(
      seller.id,
      'PASSWORD_RESET',
    );

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Check max attempts
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await this.sellerRepo.expireOtp(otpRecord.id);
      throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
    }

    // Increment attempts
    await this.sellerRepo.incrementOtpAttempts(otpRecord.id);

    // Compare OTP hash in constant time — see
    // identity/verify-reset-otp.use-case.ts for rationale.
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const actual = Buffer.from(otpHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!isMatch) {
      const remainingAttempts = otpRecord.maxAttempts - (otpRecord.attempts + 1);
      if (remainingAttempts <= 0) {
        await this.sellerRepo.expireOtp(otpRecord.id);
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP valid — generate reset token
    const resetToken = randomUUID();

    await this.sellerRepo.updateOtp(otpRecord.id, {
      verifiedAt: new Date(),
      resetToken,
    });

    this.logger.log(`Seller OTP verified for: ${seller.id}`);

    return { resetToken };
  }
}
