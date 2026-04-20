import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface ForgotPasswordFranchiseInput {
  email: string;
}

@Injectable()
export class ForgotPasswordFranchiseUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ForgotPasswordFranchiseUseCase');
  }

  async execute(input: ForgotPasswordFranchiseInput): Promise<void> {
    const { email } = input;

    const franchise = await this.franchiseRepo.findByEmail(email);

    if (!franchise || franchise.status !== 'ACTIVE') {
      await this.simulateDelay();
      return;
    }

    // Check cooldown
    const recentOtp = await this.franchiseRepo.findRecentOtp({
      franchisePartnerId: franchise.id,
      unusedOnly: true,
      createdAfter: new Date(Date.now() - ForgotPasswordFranchiseUseCase.COOLDOWN_SECONDS * 1000),
    });

    if (recentOtp) return;

    // Invalidate existing OTPs
    await this.franchiseRepo.invalidateActiveOtps(franchise.id);

    // Generate 6-digit OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.franchiseRepo.createOtp({
      franchisePartnerId: franchise.id,
      otpHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + ForgotPasswordFranchiseUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
    });

    await this.emailOtp.sendOtp(email, otp);

    this.eventBus.publish({
      eventName: 'franchise.password_reset_requested',
      aggregate: 'franchise',
      aggregateId: franchise.id,
      occurredAt: new Date(),
      payload: { franchiseId: franchise.id },
    }).catch((err) => {
      this.logger.error(`Failed to publish franchise password reset event: ${err}`);
    });

    this.logger.log(`Franchise password reset OTP sent for: ${franchise.id}`);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
