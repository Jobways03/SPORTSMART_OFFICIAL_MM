import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../identity/infrastructure/adapters/email-otp.adapter';

interface ForgotPasswordSellerInput {
  email: string;
}

@Injectable()
export class ForgotPasswordSellerUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ForgotPasswordSellerUseCase');
  }

  async execute(input: ForgotPasswordSellerInput): Promise<void> {
    const { email } = input;

    const seller = await this.prisma.seller.findUnique({ where: { email } });

    if (!seller || seller.status !== 'ACTIVE') {
      await this.simulateDelay();
      return;
    }

    // Check cooldown
    const recentOtp = await this.prisma.sellerPasswordResetOtp.findFirst({
      where: {
        sellerId: seller.id,
        usedAt: null,
        createdAt: {
          gte: new Date(Date.now() - ForgotPasswordSellerUseCase.COOLDOWN_SECONDS * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) return;

    // Invalidate existing OTPs
    await this.prisma.sellerPasswordResetOtp.updateMany({
      where: {
        sellerId: seller.id,
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
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + ForgotPasswordSellerUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
      },
    });

    await this.emailOtp.sendOtp(email, otp);

    this.eventBus.publish({
      eventName: 'seller.password_reset_requested',
      aggregate: 'seller',
      aggregateId: seller.id,
      occurredAt: new Date(),
      payload: { sellerId: seller.id },
    }).catch((err) => {
      this.logger.error(`Failed to publish seller password reset event: ${err}`);
    });

    this.logger.log(`Seller password reset OTP sent for: ${seller.id}`);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
