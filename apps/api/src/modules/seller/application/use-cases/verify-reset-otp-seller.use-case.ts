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

    // Phase 26 (2026-05-20) — atomic CAS attempt increment. The
    // sellerRepo.incrementOtpAttemptsCas method (added Phase 18)
    // expresses the "still active AND below cap" predicate inside
    // the UPDATE WHERE so two parallel verify requests cannot both
    // pass the eligibility check. Pre-Phase-26 the seller path used
    // read-then-increment which let an attacker race the rate limit
    // for an extra guess; the customer path already used CAS.
    const inc = await this.sellerRepo.incrementOtpAttemptsCas(
      otpRecord.id,
      otpRecord.maxAttempts,
    );
    if (!inc.ok) {
      await this.sellerRepo.expireOtp(otpRecord.id);
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new OTP.',
      );
    }

    // Compare OTP hash in constant time — see
    // identity/verify-reset-otp.use-case.ts for rationale.
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const actual = Buffer.from(otpHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!isMatch) {
      const remainingAttempts = otpRecord.maxAttempts - inc.attempts;
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
