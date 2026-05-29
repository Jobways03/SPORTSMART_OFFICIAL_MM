import { Injectable, Inject } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { UnauthorizedAppException, BadRequestAppException } from '../../../../core/exceptions';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface VerifySellerEmailInput {
  sellerId: string;
  otp: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class VerifySellerEmailUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    // Phase 27 (2026-05-21) — audit verify success / failure so a
    // brute-force attempt surfaces in incident response.
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('VerifySellerEmailUseCase');
  }

  async execute(input: VerifySellerEmailInput): Promise<{ isEmailVerified: boolean }> {
    const { sellerId, otp, ipAddress, userAgent } = input;

    const seller = await this.sellerRepo.findByIdSelect(sellerId, {
      id: true,
      isEmailVerified: true,
    });

    if (!seller) {
      throw new UnauthorizedAppException('Invalid request');
    }

    if (seller.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    // Find latest unexpired, unused, unverified OTP for EMAIL_VERIFICATION
    const otpRecord = await this.sellerRepo.findLatestValidOtp(
      sellerId,
      'EMAIL_VERIFICATION',
    );

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Phase 27 (2026-05-21) — atomic CAS attempt increment. The
    // sellerRepo.incrementOtpAttemptsCas method (added Phase 18 for the
    // password-reset verify path) is reused here so two parallel
    // verify requests on the same OTP can't both pass the
    // attempts<cap eligibility check. The previous read-then-increment
    // pattern let an attacker race the rate limit for an extra guess.
    // The public-verify-franchise-email path already uses CAS;
    // verify-seller-email + verify-franchise-email (authenticated)
    // were the last two non-CAS verify paths.
    const inc = await this.sellerRepo.incrementOtpAttemptsCas(
      otpRecord.id,
      otpRecord.maxAttempts,
    );
    if (!inc.ok) {
      await this.sellerRepo.expireOtp(otpRecord.id);
      this.writeAudit(sellerId, 'SELLER_EMAIL_VERIFY_FAILED', {
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
        await this.sellerRepo.expireOtp(otpRecord.id);
        this.writeAudit(sellerId, 'SELLER_EMAIL_VERIFY_FAILED', {
          reason: 'attempts_cap_reached_after_mismatch',
          ipAddress,
          userAgent,
        });
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      this.writeAudit(sellerId, 'SELLER_EMAIL_VERIFY_FAILED', {
        reason: 'invalid_otp',
        remainingAttempts,
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP valid — mark verified and update seller
    await this.sellerRepo.verifyEmailTransaction({
      sellerId,
      otpId: otpRecord.id,
    });

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
    this.writeAudit(sellerId, 'SELLER_EMAIL_VERIFY_SUCCESS', {
      ipAddress,
      userAgent,
    });

    return { isEmailVerified: true };
  }

  private writeAudit(
    sellerId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): void {
    this.audit
      .writeAuditLog({
        actorId: sellerId,
        actorRole: 'SELLER',
        action,
        module: 'seller-auth',
        resource: 'Seller',
        resourceId: sellerId,
        newValue: metadata,
        ipAddress:
          typeof metadata.ipAddress === 'string' ? metadata.ipAddress : undefined,
        userAgent:
          typeof metadata.userAgent === 'string' ? metadata.userAgent : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for ${action} (${sellerId}): ${(err as Error)?.message}`,
        ),
      );
  }
}
