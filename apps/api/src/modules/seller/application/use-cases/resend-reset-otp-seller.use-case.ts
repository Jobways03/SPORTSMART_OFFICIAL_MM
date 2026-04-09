import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface ResendResetOtpSellerInput {
  email: string;
}

@Injectable()
export class ResendResetOtpSellerUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;
  private static readonly MAX_RESENDS_PER_HOUR = 5;

  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResendResetOtpSellerUseCase');
  }

  async execute(input: ResendResetOtpSellerInput): Promise<void> {
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
      createdAfter: new Date(Date.now() - ResendResetOtpSellerUseCase.COOLDOWN_SECONDS * 1000),
    });

    if (recentOtp) return;

    // Check hourly resend cap
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const resendsInLastHour = await this.sellerRepo.countOtpsSince(seller.id, oneHourAgo);

    if (resendsInLastHour >= ResendResetOtpSellerUseCase.MAX_RESENDS_PER_HOUR) return;

    // Invalidate existing OTPs
    await this.sellerRepo.invalidateActiveOtps(seller.id);

    // Generate new OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.sellerRepo.createOtp({
      sellerId: seller.id,
      otpHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + ResendResetOtpSellerUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
    });

    await this.emailOtp.sendOtp(email, otp);

    this.logger.log(`Seller password reset OTP resent for: ${seller.id}`);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
