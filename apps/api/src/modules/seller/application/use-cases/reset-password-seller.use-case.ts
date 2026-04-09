import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface ResetPasswordSellerInput {
  resetToken: string;
  newPassword: string;
}

@Injectable()
export class ResetPasswordSellerUseCase {
  private static readonly RESET_TOKEN_TTL_MINUTES = 15;

  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResetPasswordSellerUseCase');
  }

  async execute(input: ResetPasswordSellerInput): Promise<void> {
    const { resetToken, newPassword } = input;

    const otpRecord = await this.sellerRepo.findOtpByResetToken(resetToken);

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired reset token');
    }

    if (!otpRecord.verifiedAt) {
      throw new UnauthorizedAppException('Invalid or expired reset token');
    }

    if (otpRecord.usedAt) {
      throw new UnauthorizedAppException('This reset token has already been used');
    }

    // Check reset token TTL (15 minutes from verification)
    const tokenAge = Date.now() - otpRecord.verifiedAt.getTime();
    if (tokenAge > ResetPasswordSellerUseCase.RESET_TOKEN_TTL_MINUTES * 60 * 1000) {
      throw new UnauthorizedAppException('Reset token has expired. Please start over.');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atomic update: password + OTP used + invalidate other OTPs + revoke sessions
    await this.sellerRepo.resetPasswordTransaction({
      sellerId: otpRecord.sellerId,
      otpId: otpRecord.id,
      passwordHash,
    });

    this.eventBus.publish({
      eventName: 'seller.password_reset_completed',
      aggregate: 'seller',
      aggregateId: otpRecord.sellerId,
      occurredAt: new Date(),
      payload: { sellerId: otpRecord.sellerId },
    }).catch((err) => {
      this.logger.error(`Failed to publish seller password reset completed event: ${err}`);
    });

    this.logger.log(`Seller password reset completed for: ${otpRecord.sellerId}`);
  }
}
