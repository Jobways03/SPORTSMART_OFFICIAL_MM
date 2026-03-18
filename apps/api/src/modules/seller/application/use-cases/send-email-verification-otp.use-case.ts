import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../identity/infrastructure/adapters/email-otp.adapter';
import { BadRequestAppException } from '../../../../core/exceptions';

@Injectable()
export class SendEmailVerificationOtpUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SendEmailVerificationOtpUseCase');
  }

  async execute(sellerId: string): Promise<void> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, email: true, isEmailVerified: true, status: true },
    });

    if (!seller) return;

    if (seller.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    // Check cooldown — only for EMAIL_VERIFICATION purpose
    const recentOtp = await this.prisma.sellerPasswordResetOtp.findFirst({
      where: {
        sellerId: seller.id,
        purpose: 'EMAIL_VERIFICATION',
        usedAt: null,
        createdAt: {
          gte: new Date(Date.now() - SendEmailVerificationOtpUseCase.COOLDOWN_SECONDS * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      throw new BadRequestAppException('Please wait before requesting another OTP');
    }

    // Invalidate existing EMAIL_VERIFICATION OTPs
    await this.prisma.sellerPasswordResetOtp.updateMany({
      where: {
        sellerId: seller.id,
        purpose: 'EMAIL_VERIFICATION',
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { expiresAt: new Date() },
    });

    // Generate 6-digit OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.prisma.sellerPasswordResetOtp.create({
      data: {
        sellerId: seller.id,
        otpHash,
        purpose: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + SendEmailVerificationOtpUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
      },
    });

    await this.emailOtp.sendOtp(seller.email, otp);

    this.eventBus.publish({
      eventName: 'seller.email_verification_otp_sent',
      aggregate: 'seller',
      aggregateId: seller.id,
      occurredAt: new Date(),
      payload: { sellerId: seller.id },
    }).catch((err) => {
      this.logger.error(`Failed to publish email verification event: ${err}`);
    });

    this.logger.log(`Email verification OTP sent for seller: ${seller.id}`);
  }
}
