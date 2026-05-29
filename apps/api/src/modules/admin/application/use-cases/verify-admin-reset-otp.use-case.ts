import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface VerifyAdminResetOtpInput {
  email: string;
  otp: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface VerifyAdminResetOtpResult {
  resetToken: string;
}

@Injectable()
export class VerifyAdminResetOtpUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly logger: AppLoggerService,
    // Phase 26 (2026-05-20) — audit every verify outcome.
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('VerifyAdminResetOtpUseCase');
  }

  async execute(
    input: VerifyAdminResetOtpInput,
  ): Promise<VerifyAdminResetOtpResult> {
    const { email, otp, ipAddress, userAgent } = input;

    const admin = await this.adminRepo.findAdminByEmail(email);
    if (!admin) {
      // Same error as bad OTP — don't leak account existence.
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }
    // Phase 26 (2026-05-20) — re-check status at verify time. The
    // reset use case already re-checks at the password write, but
    // catching it here saves the round-trip and keeps parity with
    // the customer flow.
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    const otpRecord = await this.adminRepo.findActiveAdminOtp(admin.id);
    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Phase 26 (2026-05-20) — atomic CAS attempt increment. The
    // adminRepo.incrementAdminOtpAttemptsCas method expresses
    // "still active AND below cap" inside the UPDATE WHERE so two
    // parallel verify requests cannot both pass the eligibility check.
    // Pre-Phase-26 the admin path used read-then-increment, which
    // let an attacker race the rate limit for an extra guess.
    const inc = await this.adminRepo.incrementAdminOtpAttemptsCas(
      otpRecord.id,
      otpRecord.maxAttempts,
    );
    if (!inc.ok) {
      await this.adminRepo.expireAdminOtp(otpRecord.id);
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new OTP.',
      );
    }

    // Constant-time comparison — see verify-reset-otp.use-case.ts for rationale.
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const actual = Buffer.from(otpHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!isMatch) {
      const remaining = otpRecord.maxAttempts - inc.attempts;
      if (remaining <= 0) {
        await this.adminRepo.expireAdminOtp(otpRecord.id);
        throw new UnauthorizedAppException(
          'Too many failed attempts. Please request a new OTP.',
        );
      }
      throw new UnauthorizedAppException(
        `Invalid OTP. ${remaining} attempt(s) remaining.`,
      );
    }

    const resetToken = randomUUID();
    await this.adminRepo.markAdminOtpVerified(otpRecord.id, resetToken);

    this.logger.log(`Admin OTP verified for: ${admin.id}`);
    this.audit
      .writeAuditLog({
        actorId: admin.id,
        actorRole: 'ADMIN',
        action: 'ADMIN_PASSWORD_RESET_OTP_VERIFIED',
        module: 'admin-auth',
        resource: 'Admin',
        resourceId: admin.id,
        ipAddress,
        userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Failed to audit ADMIN_PASSWORD_RESET_OTP_VERIFIED for ${admin.id}: ${(err as Error)?.message}`,
        ),
      );

    return { resetToken };
  }
}
