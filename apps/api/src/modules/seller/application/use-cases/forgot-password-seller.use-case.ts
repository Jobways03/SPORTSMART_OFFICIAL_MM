import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface ForgotPasswordSellerInput {
  email: string;
}

@Injectable()
export class ForgotPasswordSellerUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ForgotPasswordSellerUseCase');
  }

  async execute(input: ForgotPasswordSellerInput): Promise<void> {
    const { email } = input;

    const seller = await this.sellerRepo.findByEmail(email);

    if (!seller || seller.status !== 'ACTIVE') {
      await this.simulateDelay();
      return;
    }

    // Check cooldown
    const recentOtp = await this.sellerRepo.findRecentOtp({
      sellerId: seller.id,
      unusedOnly: true,
      createdAfter: new Date(Date.now() - ForgotPasswordSellerUseCase.COOLDOWN_SECONDS * 1000),
    });

    if (recentOtp) return;

    // Invalidate existing OTPs
    await this.sellerRepo.invalidateActiveOtps(seller.id);

    // Generate 6-digit OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.sellerRepo.createOtp({
      sellerId: seller.id,
      otpHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + ForgotPasswordSellerUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
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
