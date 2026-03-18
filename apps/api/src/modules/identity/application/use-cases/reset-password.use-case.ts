import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';

interface ResetPasswordInput {
  resetToken: string;
  newPassword: string;
}

@Injectable()
export class ResetPasswordUseCase {
  private static readonly RESET_TOKEN_TTL_MINUTES = 15;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResetPasswordUseCase');
  }

  async execute(input: ResetPasswordInput): Promise<void> {
    const { resetToken, newPassword } = input;

    // Find OTP record by reset token
    const otpRecord = await this.prisma.passwordResetOtp.findUnique({
      where: { resetToken },
      include: { user: true },
    });

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired reset token');
    }

    // Validate: must be verified, not used, not expired
    if (!otpRecord.verifiedAt) {
      throw new UnauthorizedAppException('Invalid or expired reset token');
    }

    if (otpRecord.usedAt) {
      throw new UnauthorizedAppException('This reset token has already been used');
    }

    // Check reset token TTL (15 minutes from verification)
    const tokenAge = Date.now() - otpRecord.verifiedAt.getTime();
    if (tokenAge > ResetPasswordUseCase.RESET_TOKEN_TTL_MINUTES * 60 * 1000) {
      throw new UnauthorizedAppException('Reset token has expired. Please start over.');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password and mark OTP as used in transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: otpRecord.userId },
        data: { passwordHash },
      });

      await tx.passwordResetOtp.update({
        where: { id: otpRecord.id },
        data: { usedAt: new Date() },
      });

      // Revoke all active sessions for this user
      await tx.session.updateMany({
        where: {
          userId: otpRecord.userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });

    // Emit event (fire and forget)
    this.eventBus.publish({
      eventName: 'identity.user.password_reset_completed',
      aggregate: 'user',
      aggregateId: otpRecord.userId,
      occurredAt: new Date(),
      payload: { userId: otpRecord.userId },
    }).catch((err) => {
      this.logger.error(`Failed to publish password reset completed event: ${err}`);
    });

    this.logger.log(`Password reset completed for user: ${otpRecord.userId}`);
  }
}
