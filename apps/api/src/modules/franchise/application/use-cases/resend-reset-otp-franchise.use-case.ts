import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface ResendResetOtpFranchiseInput {
  email: string;
}

@Injectable()
export class ResendResetOtpFranchiseUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;
  private static readonly MAX_RESENDS_PER_HOUR = 5;

  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResendResetOtpFranchiseUseCase');
  }

  async execute(input: ResendResetOtpFranchiseInput): Promise<void> {
    const { email } = input;

    const franchise = await this.franchiseRepo.findByEmail(email);

    if (!franchise || franchise.status !== 'ACTIVE') {
      await this.simulateDelay();
      return;
    }

    // Check cooldown
    const recentOtp = await this.franchiseRepo.findRecentOtp({
      franchisePartnerId: franchise.id,
      unusedOnly: true,
      createdAfter: new Date(Date.now() - ResendResetOtpFranchiseUseCase.COOLDOWN_SECONDS * 1000),
    });

    if (recentOtp) return;

    // Check hourly resend cap
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const resendsInLastHour = await this.franchiseRepo.countOtpsSince(franchise.id, oneHourAgo);

    if (resendsInLastHour >= ResendResetOtpFranchiseUseCase.MAX_RESENDS_PER_HOUR) return;

    // Invalidate existing OTPs
    await this.franchiseRepo.invalidateActiveOtps(franchise.id);

    // Generate new OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.franchiseRepo.createOtp({
      franchisePartnerId: franchise.id,
      otpHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + ResendResetOtpFranchiseUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
    });

    await this.emailOtp.sendOtp(email, otp);

    this.logger.log(`Franchise password reset OTP resent for: ${franchise.id}`);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
