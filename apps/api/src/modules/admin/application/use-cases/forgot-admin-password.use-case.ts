import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface ForgotAdminPasswordInput {
  email: string;
}

/**
 * Sends a password-reset OTP to an admin's email. The flow mirrors the
 * seller and franchise password reset to keep behaviour consistent across
 * actor types:
 *  - silent return if the email is unknown or the account is inactive
 *    (no enumeration via response)
 *  - 60-second cooldown between OTP requests
 *  - 10-minute OTP TTL
 *  - any prior unused OTPs are invalidated when a new one is created
 */
@Injectable()
export class ForgotAdminPasswordUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ForgotAdminPasswordUseCase');
  }

  async execute(input: ForgotAdminPasswordInput): Promise<void> {
    const { email } = input;

    const admin = await this.adminRepo.findAdminByEmail(email);
    if (!admin || admin.status !== 'ACTIVE') {
      await this.simulateDelay();
      return;
    }

    // Cooldown — silently swallow if the admin requested a fresh OTP very
    // recently. Returning silently means an attacker can't tell whether
    // their request was rate-limited or successful.
    const recent = await this.adminRepo.findRecentAdminOtp({
      adminId: admin.id,
      unusedOnly: true,
      createdAfter: new Date(
        Date.now() - ForgotAdminPasswordUseCase.COOLDOWN_SECONDS * 1000,
      ),
    });
    if (recent) return;

    // Invalidate previous OTPs so only the latest one is usable.
    await this.adminRepo.invalidateActiveAdminOtps(admin.id);

    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.adminRepo.createAdminOtp({
      adminId: admin.id,
      otpHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(
        Date.now() + ForgotAdminPasswordUseCase.OTP_EXPIRY_MINUTES * 60 * 1000,
      ),
    });

    await this.emailOtp.sendOtp(email, otp);

    this.logger.log(`Admin password reset OTP sent for: ${admin.id}`);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
