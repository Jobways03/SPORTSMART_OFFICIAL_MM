import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException, BadRequestAppException } from '../../../../core/exceptions';

interface VerifySellerEmailInput {
  sellerId: string;
  otp: string;
}

@Injectable()
export class VerifySellerEmailUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifySellerEmailUseCase');
  }

  async execute(input: VerifySellerEmailInput): Promise<{ isEmailVerified: boolean }> {
    const { sellerId, otp } = input;

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, isEmailVerified: true },
    });

    if (!seller) {
      throw new UnauthorizedAppException('Invalid request');
    }

    if (seller.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    // Find latest unexpired, unused, unverified OTP for EMAIL_VERIFICATION
    const otpRecord = await this.prisma.sellerPasswordResetOtp.findFirst({
      where: {
        sellerId,
        purpose: 'EMAIL_VERIFICATION',
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Check max attempts
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await this.prisma.sellerPasswordResetOtp.update({
        where: { id: otpRecord.id },
        data: { expiresAt: new Date() },
      });
      throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
    }

    // Increment attempts
    await this.prisma.sellerPasswordResetOtp.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });

    // Compare OTP hash
    const otpHash = createHash('sha256').update(otp).digest('hex');
    if (otpHash !== otpRecord.otpHash) {
      const remainingAttempts = otpRecord.maxAttempts - (otpRecord.attempts + 1);
      if (remainingAttempts <= 0) {
        await this.prisma.sellerPasswordResetOtp.update({
          where: { id: otpRecord.id },
          data: { expiresAt: new Date() },
        });
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP valid — mark verified and update seller
    await this.prisma.$transaction([
      this.prisma.sellerPasswordResetOtp.update({
        where: { id: otpRecord.id },
        data: { verifiedAt: new Date(), usedAt: new Date() },
      }),
      this.prisma.seller.update({
        where: { id: sellerId },
        data: { isEmailVerified: true },
      }),
    ]);

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
