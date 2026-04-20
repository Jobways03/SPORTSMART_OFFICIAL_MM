import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface ResendAdminResetOtpInput {
  email: string;
}

@Injectable()
export class ResendAdminResetOtpUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResendAdminResetOtpUseCase');
  }

  async execute(input: ResendAdminResetOtpInput): Promise<void> {
    const admin = await this.adminRepo.findAdminByEmail(input.email);
    if (!admin || admin.status !== 'ACTIVE') return;

    // Same cooldown as the initial request — prevents abuse.
    const recent = await this.adminRepo.findRecentAdminOtp({
      adminId: admin.id,
      unusedOnly: true,
      createdAfter: new Date(
        Date.now() - ResendAdminResetOtpUseCase.COOLDOWN_SECONDS * 1000,
      ),
    });
    if (recent) return;

    await this.adminRepo.invalidateActiveAdminOtps(admin.id);

    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.adminRepo.createAdminOtp({
      adminId: admin.id,
      otpHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(
        Date.now() + ResendAdminResetOtpUseCase.OTP_EXPIRY_MINUTES * 60 * 1000,
      ),
    });

    await this.emailOtp.sendOtp(input.email, otp);
    this.logger.log(`Admin password reset OTP resent for: ${admin.id}`);
  }
}
