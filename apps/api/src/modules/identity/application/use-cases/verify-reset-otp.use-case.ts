import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';

interface VerifyResetOtpInput {
  email: string;
  otp: string;
}

export interface VerifyResetOtpResult {
  resetToken: string;
}

@Injectable()
export class VerifyResetOtpUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifyResetOtpUseCase');
  }

  async execute(input: VerifyResetOtpInput): Promise<VerifyResetOtpResult> {
    const { email, otp } = input;

    const user = await this.userRepo.findByEmail(email) as any;

    if (!user) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Find the latest unexpired, unused OTP for this user
    const otpRecord = await this.userRepo.findActiveOtp(user.id);

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Check max attempts
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      // Expire this OTP
      await this.userRepo.expireOtp(otpRecord.id);
      throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
    }

    // Increment attempts
    await this.userRepo.incrementOtpAttempts(otpRecord.id);

    // Compare OTP hash
    const otpHash = createHash('sha256').update(otp).digest('hex');
    if (otpHash !== otpRecord.otpHash) {
      const remainingAttempts = otpRecord.maxAttempts - (otpRecord.attempts + 1);
      if (remainingAttempts <= 0) {
        // Expire after last failed attempt
        await this.userRepo.expireOtp(otpRecord.id);
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP is valid -- generate reset token
    const resetToken = randomUUID();

    await this.userRepo.markOtpVerified(otpRecord.id, resetToken);

    this.logger.log(`OTP verified for user: ${user.id}`);

    return { resetToken };
  }
}
