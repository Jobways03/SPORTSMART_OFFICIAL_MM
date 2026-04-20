import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException, BadRequestAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface VerifyFranchiseEmailInput {
  franchiseId: string;
  otp: string;
}

@Injectable()
export class VerifyFranchiseEmailUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifyFranchiseEmailUseCase');
  }

  async execute(input: VerifyFranchiseEmailInput): Promise<{ isEmailVerified: boolean }> {
    const { franchiseId, otp } = input;

    const franchise = await this.franchiseRepo.findByIdSelect(franchiseId, {
      id: true,
      isEmailVerified: true,
    });

    if (!franchise) {
      throw new UnauthorizedAppException('Invalid request');
    }

    if (franchise.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    // Find latest unexpired, unused, unverified OTP for EMAIL_VERIFICATION
    const otpRecord = await this.franchiseRepo.findLatestValidOtp(
      franchiseId,
      'EMAIL_VERIFICATION',
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

    // OTP valid — mark verified and update franchise
    await this.franchiseRepo.verifyEmailTransaction({
      franchisePartnerId: franchiseId,
      otpId: otpRecord.id,
    });

    this.eventBus.publish({
      eventName: 'franchise.email_verified',
      aggregate: 'franchise',
      aggregateId: franchiseId,
      occurredAt: new Date(),
      payload: { franchiseId },
    }).catch((err) => {
      this.logger.error(`Failed to publish email verified event: ${err}`);
    });

    this.logger.log(`Franchise email verified: ${franchiseId}`);

    return { isEmailVerified: true };
  }
}
