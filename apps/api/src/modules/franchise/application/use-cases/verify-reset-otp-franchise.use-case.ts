import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface VerifyResetOtpFranchiseInput {
  email: string;
  otp: string;
}

export interface VerifyResetOtpFranchiseResult {
  resetToken: string;
}

@Injectable()
export class VerifyResetOtpFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifyResetOtpFranchiseUseCase');
  }

  async execute(input: VerifyResetOtpFranchiseInput): Promise<VerifyResetOtpFranchiseResult> {
    const { email, otp } = input;

    const franchise = await this.franchiseRepo.findByEmail(email);
    if (!franchise) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Find latest unexpired, unused, unverified OTP
    const otpRecord = await this.franchiseRepo.findLatestValidOtp(
      franchise.id,
      'PASSWORD_RESET',
    );

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Check max attempts
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await this.franchiseRepo.expireOtp(otpRecord.id);
      throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
    }

    // Increment attempts
    await this.franchiseRepo.incrementOtpAttempts(otpRecord.id);

    // Compare OTP hash
    const otpHash = createHash('sha256').update(otp).digest('hex');
    if (otpHash !== otpRecord.otpHash) {
      const remainingAttempts = otpRecord.maxAttempts - (otpRecord.attempts + 1);
      if (remainingAttempts <= 0) {
        await this.franchiseRepo.expireOtp(otpRecord.id);
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP valid — generate reset token
    const resetToken = randomUUID();

    await this.franchiseRepo.updateOtp(otpRecord.id, {
      verifiedAt: new Date(),
      resetToken,
    });

    this.logger.log(`Franchise OTP verified for: ${franchise.id}`);

    return { resetToken };
  }
}
