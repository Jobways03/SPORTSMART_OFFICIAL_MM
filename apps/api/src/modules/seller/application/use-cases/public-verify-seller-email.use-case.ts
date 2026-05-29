import { Injectable, Inject } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { SellerVerifyEmailResponseData } from '../../presentation/dtos/seller-auth-response.dto';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface PublicVerifySellerEmailInput {
  email: string;
  otp: string;
}

/**
 * Phase 18 (2026-05-20) — PUBLIC (unauthenticated) seller verify-email
 * use case.
 *
 * Distinct from the older `VerifySellerEmailUseCase` which sits behind
 * SellerAuthGuard (authed sellers verifying from the onboarding
 * dashboard). The audit flagged that authed-only verify endpoint as
 * the root cause of "login allowed for unverified sellers" — without
 * a public path, a brand-new seller had to log in first to verify.
 *
 * Flow:
 *   1. Look up seller by email. Unknown → uniform 401 (no enum leak).
 *   2. If already verified → 400 ALREADY_VERIFIED so the frontend
 *      can route the user to login instead of looping.
 *   3. Load the latest active EMAIL_VERIFICATION OTP.
 *   4. Atomic CAS attempt-increment (mirrors the identity module's
 *      pattern — defeats the concurrent-verify race that the audit
 *      called out at risk level MEDIUM).
 *   5. Constant-time compare of SHA-256 hashes.
 *   6. On match: verifyEmailTransaction (atomic: OTP consumed +
 *      isEmailVerified=true + emailVerifiedAt=now).
 *   7. Emit seller.email_verified.
 */
@Injectable()
export class PublicVerifySellerEmailUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('PublicVerifySellerEmailUseCase');
  }

  async execute(
    input: PublicVerifySellerEmailInput,
  ): Promise<SellerVerifyEmailResponseData> {
    const { email, otp } = input;

    const seller = await this.sellerRepo.findByEmail(email);
    if (!seller) {
      // Uniform "no such OTP" — does not reveal whether the email
      // is registered.
      throw new UnauthorizedAppException(
        'Invalid or expired verification code',
      );
    }

    if (seller.isEmailVerified) {
      throw new BadRequestAppException(
        'This account is already verified. Please sign in.',
        'ALREADY_VERIFIED',
      );
    }

    const otpRecord = await this.sellerRepo.findLatestValidOtp(
      seller.id,
      'EMAIL_VERIFICATION',
    );
    if (!otpRecord) {
      throw new UnauthorizedAppException(
        'Invalid or expired verification code',
      );
    }

    // Atomic CAS — the WHERE clause asserts "still active AND below
    // cap" inside the same UPDATE, so two parallel verifies can't
    // both pass the eligibility check.
    const inc = await this.sellerRepo.incrementOtpAttemptsCas(
      otpRecord.id,
      otpRecord.maxAttempts,
    );
    if (!inc.ok) {
      await this.sellerRepo.expireOtp(otpRecord.id);
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new verification code.',
      );
    }

    // Constant-time compare; both sides are 64-char hex strings so
    // length parity holds, but guard anyway.
    const candidateHash = createHash('sha256').update(otp).digest('hex');
    const candidate = Buffer.from(candidateHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected);

    if (!isMatch) {
      const remaining = otpRecord.maxAttempts - inc.attempts;
      if (remaining <= 0) {
        await this.sellerRepo.expireOtp(otpRecord.id);
        throw new UnauthorizedAppException(
          'Too many failed attempts. Please request a new verification code.',
        );
      }
      throw new UnauthorizedAppException(
        `Invalid verification code. ${remaining} attempt(s) remaining.`,
      );
    }

    // OTP matches — atomic transaction: consume OTP + flip the
    // seller's isEmailVerified + stamp emailVerifiedAt.
    await this.sellerRepo.verifyEmailTransaction({
      sellerId: seller.id,
      otpId: otpRecord.id,
    });

    this.eventBus
      .publish({
        eventName: 'seller.email_verified',
        aggregate: 'seller',
        aggregateId: seller.id,
        occurredAt: new Date(),
        payload: { sellerId: seller.id },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to publish seller.email_verified for ${seller.id}: ${err}`,
        );
      });

    this.logger.log(`Seller email verified (public path): ${seller.id}`);

    return { email: seller.email, verified: true };
  }
}
