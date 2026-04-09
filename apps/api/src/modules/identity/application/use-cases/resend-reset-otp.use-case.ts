import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';

interface ResendResetOtpInput {
  email: string;
}

@Injectable()
export class ResendResetOtpUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResendResetOtpUseCase');
  }

  async execute(input: ResendResetOtpInput): Promise<void> {
    const { email } = input;

    // Always return success to prevent email enumeration
    const user = await this.userRepo.findByEmail(email) as any;

    if (!user || user.status !== 'ACTIVE') {
      await this.simulateDelay();
      return;
    }

    // Check cooldown
    const recentOtp = await this.userRepo.findRecentOtp(
      user.id,
      ResendResetOtpUseCase.COOLDOWN_SECONDS,
    );

    if (recentOtp) {
      return;
    }

    // Invalidate existing OTPs
    await this.userRepo.invalidateActiveOtps(user.id);

    // Generate new OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.userRepo.createOtp(
      user.id,
      otpHash,
      new Date(Date.now() + ResendResetOtpUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
    );

    await this.emailOtp.sendOtp(email, otp);

    this.logger.log(`Password reset OTP resent for user: ${user.id}`);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
