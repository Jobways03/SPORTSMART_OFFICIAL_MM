import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException, BadRequestAppException } from '../../../../core/exceptions';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface VerifySellerEmailInput {
  sellerId: string;
  otp: string;
}

@Injectable()
export class VerifySellerEmailUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifySellerEmailUseCase');
  }

  async execute(input: VerifySellerEmailInput): Promise<{ isEmailVerified: boolean }> {
    const { sellerId, otp } = input;

    const seller = await this.sellerRepo.findByIdSelect(sellerId, {
      id: true,
      isEmailVerified: true,
    });

    if (!seller) {
      throw new UnauthorizedAppException('Invalid request');
    }

    if (seller.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    // Find latest unexpired, unused, unverified OTP for EMAIL_VERIFICATION
    const otpRecord = await this.sellerRepo.findLatestValidOtp(
      sellerId,
      'EMAIL_VERIFICATION',
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

    // Compare OTP hash
    const otpHash = createHash('sha256').update(otp).digest('hex');
    if (otpHash !== otpRecord.otpHash) {
      const remainingAttempts = otpRecord.maxAttempts - (otpRecord.attempts + 1);
      if (remainingAttempts <= 0) {
        await this.sellerRepo.expireOtp(otpRecord.id);
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP valid — mark verified and update seller
    await this.sellerRepo.verifyEmailTransaction({
      sellerId,
      otpId: otpRecord.id,
    });

    this.eventBus.publish({
      eventName: 'seller.email_verified',
      aggregate: 'seller',
      aggregateId: sellerId,
      occurredAt: new Date(),
      payload: { sellerId },
    }).catch((err) => {
      this.logger.error(`Failed to publish email verified event: ${err}`);
    });

    this.logger.log(`Seller email verified: ${sellerId}`);

    return { isEmailVerified: true };
  }
}
