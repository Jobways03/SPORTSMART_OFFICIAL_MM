import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';

interface ForgotPasswordInput {
  email: string;
}

@Injectable()
export class ForgotPasswordUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ForgotPasswordUseCase');
  }

  async execute(input: ForgotPasswordInput): Promise<void> {
    const { email } = input;

    // Always return success to prevent email enumeration
    const user = await this.userRepo.findByEmail(email) as any;

    if (!user || user.status !== 'ACTIVE') {
      // Simulate delay to prevent timing attacks
      await this.simulateDelay();
      return;
    }

    // Check cooldown: find most recent unexpired OTP
    const recentOtp = await this.userRepo.findRecentOtp(
      user.id,
      ForgotPasswordUseCase.COOLDOWN_SECONDS,
    );

    if (recentOtp) {
      // Cooldown active -- silently return to prevent abuse info leakage
      return;
    }

    // Invalidate any existing unexpired OTPs
    await this.userRepo.invalidateActiveOtps(user.id);

    // Generate 6-digit OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    // Store hashed OTP
    await this.userRepo.createOtp(
      user.id,
      otpHash,
      new Date(Date.now() + ForgotPasswordUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
    );

    // Send OTP via email
    await this.emailOtp.sendOtp(email, otp);

    // Emit event (fire and forget)
    this.eventBus.publish({
      eventName: 'identity.user.password_reset_requested',
      aggregate: 'user',
      aggregateId: user.id,
      occurredAt: new Date(),
      payload: { userId: user.id },
    }).catch((err) => {
      this.logger.error(`Failed to publish password reset event: ${err}`);
    });

    this.logger.log(`Password reset OTP sent for user: ${user.id}`);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
