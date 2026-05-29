import { Injectable, Inject } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { FranchiseVerifyEmailResponseData } from '../../presentation/dtos/franchise-auth-response.dto';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface PublicVerifyFranchiseEmailInput {
  email: string;
  otp: string;
}

/**
 * Phase 20 (2026-05-20) — Public (unauthenticated) franchise
 * verify-email use case.
 *
 * Solves the pre-Phase-20 chicken-and-egg: the only verify endpoint
 * was authed, so a brand-new franchise had to log in first — but
 * login should require verification. The new public endpoint accepts
 * `{email, otp}` so verification happens BEFORE login.
 *
 * Flow:
 *   1. findByEmail; unknown → uniform 401 (no enumeration).
 *   2. Already verified → ALREADY_VERIFIED 400.
 *   3. Load latest active EMAIL_VERIFICATION OTP.
 *   4. Atomic CAS attempts increment (Phase 20).
 *   5. Constant-time hash compare.
 *   6. verifyEmailTransaction → emailVerifiedAt stamped.
 *   7. Emit franchise.email_verified.
 */
@Injectable()
export class PublicVerifyFranchiseEmailUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('PublicVerifyFranchiseEmailUseCase');
  }

  async execute(
    input: PublicVerifyFranchiseEmailInput,
  ): Promise<FranchiseVerifyEmailResponseData> {
    const { email, otp } = input;

    const franchise = await this.franchiseRepo.findByEmail(email);
    if (!franchise) {
      throw new UnauthorizedAppException('Invalid or expired verification code');
    }

    if (franchise.isEmailVerified) {
      throw new BadRequestAppException(
        'This account is already verified. Please sign in.',
        'ALREADY_VERIFIED',
      );
    }

    const otpRecord = await this.franchiseRepo.findLatestValidOtp(
      franchise.id,
      'EMAIL_VERIFICATION',
    );
    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired verification code');
    }

    const inc = await this.franchiseRepo.incrementOtpAttemptsCas(
      otpRecord.id,
      otpRecord.maxAttempts,
    );
    if (!inc.ok) {
      await this.franchiseRepo.expireOtp(otpRecord.id);
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new verification code.',
      );
    }

    const candidateHash = createHash('sha256').update(otp).digest('hex');
    const candidate = Buffer.from(candidateHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected);

    if (!isMatch) {
      const remaining = otpRecord.maxAttempts - inc.attempts;
      if (remaining <= 0) {
        await this.franchiseRepo.expireOtp(otpRecord.id);
        throw new UnauthorizedAppException(
          'Too many failed attempts. Please request a new verification code.',
        );
      }
      throw new UnauthorizedAppException(
        `Invalid verification code. ${remaining} attempt(s) remaining.`,
      );
    }

    await this.franchiseRepo.verifyEmailTransaction({
      franchisePartnerId: franchise.id,
      otpId: otpRecord.id,
    });

    this.eventBus
      .publish({
        eventName: 'franchise.email_verified',
        aggregate: 'franchise',
        aggregateId: franchise.id,
        occurredAt: new Date(),
        payload: { franchiseId: franchise.id, email: franchise.email },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to publish franchise.email_verified for ${franchise.id}: ${err}`,
        );
      });

    this.logger.log(`Franchise email verified (public path): ${franchise.id}`);

    return { email: franchise.email, verified: true };
  }
}
