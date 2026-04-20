import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import { BadRequestAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

@Injectable()
export class SendFranchiseEmailVerificationUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SendFranchiseEmailVerificationUseCase');
  }

  async execute(franchiseId: string): Promise<void> {
    const franchise = await this.franchiseRepo.findByIdSelect(franchiseId, {
      id: true,
      email: true,
      isEmailVerified: true,
      status: true,
    });

    if (!franchise) return;

    if (franchise.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    // Check cooldown — only for EMAIL_VERIFICATION purpose
    const recentOtp = await this.franchiseRepo.findRecentOtp({
      franchisePartnerId: franchise.id,
      purpose: 'EMAIL_VERIFICATION',
      unusedOnly: true,
      createdAfter: new Date(Date.now() - SendFranchiseEmailVerificationUseCase.COOLDOWN_SECONDS * 1000),
    });

    if (recentOtp) {
      throw new BadRequestAppException('Please wait before requesting another OTP');
    }

    // Invalidate existing EMAIL_VERIFICATION OTPs
    await this.franchiseRepo.invalidateActiveOtps(franchise.id, 'EMAIL_VERIFICATION');

    // Generate 6-digit OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.franchiseRepo.createOtp({
      franchisePartnerId: franchise.id,
      otpHash,
      purpose: 'EMAIL_VERIFICATION',
      expiresAt: new Date(Date.now() + SendFranchiseEmailVerificationUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
    });

    await this.emailOtp.sendOtp(franchise.email, otp);

    this.eventBus.publish({
      eventName: 'franchise.email_verification_otp_sent',
      aggregate: 'franchise',
      aggregateId: franchise.id,
      occurredAt: new Date(),
      payload: { franchiseId: franchise.id },
    }).catch((err) => {
      this.logger.error(`Failed to publish email verification event: ${err}`);
    });

    this.logger.log(`Email verification OTP sent for franchise: ${franchise.id}`);
  }
}
