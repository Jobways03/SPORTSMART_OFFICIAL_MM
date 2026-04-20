import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface ResetPasswordFranchiseInput {
  resetToken: string;
  newPassword: string;
}

@Injectable()
export class ResetPasswordFranchiseUseCase {
  private static readonly RESET_TOKEN_TTL_MINUTES = 15;

  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResetPasswordFranchiseUseCase');
  }

  async execute(input: ResetPasswordFranchiseInput): Promise<void> {
    const { resetToken, newPassword } = input;

    const otpRecord = await this.franchiseRepo.findOtpByResetToken(resetToken);

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
    if (tokenAge > ResetPasswordFranchiseUseCase.RESET_TOKEN_TTL_MINUTES * 60 * 1000) {
      throw new UnauthorizedAppException('Reset token has expired. Please start over.');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atomic update: password + OTP used + invalidate other OTPs + revoke sessions
    await this.franchiseRepo.resetPasswordTransaction({
      franchisePartnerId: otpRecord.franchisePartnerId,
      otpId: otpRecord.id,
      passwordHash,
    });

    this.eventBus.publish({
      eventName: 'franchise.password_reset_completed',
      aggregate: 'franchise',
      aggregateId: otpRecord.franchisePartnerId,
      occurredAt: new Date(),
      payload: { franchiseId: otpRecord.franchisePartnerId },
    }).catch((err) => {
      this.logger.error(`Failed to publish franchise password reset completed event: ${err}`);
    });

    this.logger.log(`Franchise password reset completed for: ${otpRecord.franchisePartnerId}`);
  }
}
