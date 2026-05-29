import { Injectable, Inject } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { UnauthorizedAppException, BadRequestAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface VerifyFranchiseEmailInput {
  franchiseId: string;
  otp: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class VerifyFranchiseEmailUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    // Phase 27 (2026-05-21) — audit verify outcomes.
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('VerifyFranchiseEmailUseCase');
  }

  async execute(input: VerifyFranchiseEmailInput): Promise<{ isEmailVerified: boolean }> {
    const { franchiseId, otp, ipAddress, userAgent } = input;

    const franchise = await this.franchiseRepo.findByIdSelect(franchiseId, {
      id: true,
      isEmailVerified: true,
    });

    if (!franchise) {
      throw new UnauthorizedAppException('Invalid request');
    }

    if (franchise.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    // Find latest unexpired, unused, unverified OTP for EMAIL_VERIFICATION
    const otpRecord = await this.franchiseRepo.findLatestValidOtp(
      franchiseId,
      'EMAIL_VERIFICATION',
    );

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Phase 27 (2026-05-21) — atomic CAS attempt increment. See
    // verify-seller-email.use-case.ts for full rationale; the
    // public-verify-franchise-email path already uses this pattern.
    const inc = await this.franchiseRepo.incrementOtpAttemptsCas(
      otpRecord.id,
      otpRecord.maxAttempts,
    );
    if (!inc.ok) {
      await this.franchiseRepo.expireOtp(otpRecord.id);
      this.writeAudit(franchiseId, 'FRANCHISE_EMAIL_VERIFY_FAILED', {
        reason: 'attempts_cap_reached',
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new OTP.',
      );
    }

    // Compare OTP hash in constant time — see
    // identity/verify-reset-otp.use-case.ts for rationale.
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const actual = Buffer.from(otpHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!isMatch) {
      const remainingAttempts = otpRecord.maxAttempts - inc.attempts;
      if (remainingAttempts <= 0) {
        await this.franchiseRepo.expireOtp(otpRecord.id);
        this.writeAudit(franchiseId, 'FRANCHISE_EMAIL_VERIFY_FAILED', {
          reason: 'attempts_cap_reached_after_mismatch',
          ipAddress,
          userAgent,
        });
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      this.writeAudit(franchiseId, 'FRANCHISE_EMAIL_VERIFY_FAILED', {
        reason: 'invalid_otp',
        remainingAttempts,
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP valid — mark verified and update franchise
    await this.franchiseRepo.verifyEmailTransaction({
      franchisePartnerId: franchiseId,
      otpId: otpRecord.id,
    });

    this.eventBus.publish({
      eventName: 'franchise.email_verified',
      aggregate: 'franchise',
      aggregateId: franchiseId,
      occurredAt: new Date(),
      payload: { franchiseId },
    }).catch((err) => {
      this.logger.error(`Failed to publish email verified event: ${err}`);
    });

    this.logger.log(`Franchise email verified: ${franchiseId}`);
    this.writeAudit(franchiseId, 'FRANCHISE_EMAIL_VERIFY_SUCCESS', {
      ipAddress,
      userAgent,
    });

    return { isEmailVerified: true };
  }

  private writeAudit(
    franchiseId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): void {
    this.audit
      .writeAuditLog({
        actorId: franchiseId,
        actorRole: 'FRANCHISE',
        action,
        module: 'franchise-auth',
        resource: 'FranchisePartner',
        resourceId: franchiseId,
        newValue: metadata,
        ipAddress:
          typeof metadata.ipAddress === 'string' ? metadata.ipAddress : undefined,
        userAgent:
          typeof metadata.userAgent === 'string' ? metadata.userAgent : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for ${action} (${franchiseId}): ${(err as Error)?.message}`,
        ),
      );
  }
}
