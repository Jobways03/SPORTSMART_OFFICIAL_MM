import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface VerifyAdminResetOtpInput {
  email: string;
  otp: string;
}

export interface VerifyAdminResetOtpResult {
  resetToken: string;
}

@Injectable()
export class VerifyAdminResetOtpUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifyAdminResetOtpUseCase');
  }

  async execute(
    input: VerifyAdminResetOtpInput,
  ): Promise<VerifyAdminResetOtpResult> {
    const { email, otp } = input;

    const admin = await this.adminRepo.findAdminByEmail(email);
    if (!admin) {
      // Same error as bad OTP — don't leak account existence.
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    const otpRecord = await this.adminRepo.findActiveAdminOtp(admin.id);
    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await this.adminRepo.expireAdminOtp(otpRecord.id);
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new OTP.',
      );
    }

    await this.adminRepo.incrementAdminOtpAttempts(otpRecord.id);

    // Constant-time comparison — see verify-reset-otp.use-case.ts for rationale.
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const actual = Buffer.from(otpHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!isMatch) {
      const remaining = otpRecord.maxAttempts - (otpRecord.attempts + 1);
      if (remaining <= 0) {
        await this.adminRepo.expireAdminOtp(otpRecord.id);
        throw new UnauthorizedAppException(
          'Too many failed attempts. Please request a new OTP.',
        );
      }
      throw new UnauthorizedAppException(
        `Invalid OTP. ${remaining} attempt(s) remaining.`,
      );
    }

    const resetToken = randomUUID();
    await this.adminRepo.markAdminOtpVerified(otpRecord.id, resetToken);

    this.logger.log(`Admin OTP verified for: ${admin.id}`);

    return { resetToken };
  }
}
