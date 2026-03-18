import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';

interface ChangeSellerPasswordInput {
  sellerId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

@Injectable()
export class ChangeSellerPasswordUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ChangeSellerPasswordUseCase');
  }

  async execute(input: ChangeSellerPasswordInput): Promise<void> {
    const { sellerId, currentPassword, newPassword, confirmPassword } = input;

    if (newPassword !== confirmPassword) {
      throw new BadRequestAppException('New password and confirm password do not match');
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, passwordHash: true },
    });

    if (!seller) {
      throw new UnauthorizedAppException('Seller not found');
    }

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, seller.passwordHash);
    if (!isCurrentValid) {
      throw new BadRequestAppException('Current password is incorrect');
    }

    // Prevent reusing the same password
    const isSamePassword = await bcrypt.compare(newPassword, seller.passwordHash);
    if (isSamePassword) {
      throw new BadRequestAppException('New password must be different from current password');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atomic update: password + revoke all sessions except current
    await this.prisma.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });

      // Revoke all active sessions (seller will need to re-login on other devices)
      await tx.sellerSession.updateMany({
        where: {
          sellerId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });

    this.eventBus.publish({
      eventName: 'seller.password_changed',
      aggregate: 'seller',
      aggregateId: sellerId,
      occurredAt: new Date(),
      payload: { sellerId },
    }).catch((err) => {
      this.logger.error(`Failed to publish seller password changed event: ${err}`);
    });

    this.logger.log(`Seller password changed successfully for: ${sellerId}`);
  }
}
