import { Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { VerifyEmailOtpResponseData } from '../../presentation/dtos/auth-response.dto';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';

interface VerifyEmailOtpInput {
  email: string;
  otp: string;
}

/**
 * Phase 16 (2026-05-20) — Customer registration: OTP verification.
 *
 * Flow:
 *   1. Look up the user. If absent, return a uniform "invalid or
 *      expired" 401 — no enumeration leak.
 *   2. If status is already ACTIVE + emailVerified=true, the OTP has
 *      already been consumed by a parallel request; return a 400 so
 *      the client can navigate forward to login instead of looping.
 *   3. If status is anything other than PENDING_VERIFICATION (e.g.
 *      SUSPENDED, BANNED), refuse — verification cannot un-suspend
 *      an account.
 *   4. Load the active OTP. CAS-increment attempts. Constant-time
 *      compare the hash. On match, mark consumed + flip user ACTIVE
 *      in a single transaction. Emit identity.user.email_verified.
 */
@Injectable()
export class VerifyEmailOtpUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifyEmailOtpUseCase');
  }

  async execute(
    input: VerifyEmailOtpInput,
  ): Promise<VerifyEmailOtpResponseData> {
    const { email, otp } = input;

    const user = await this.userRepo.findByEmailForVerification(email);
    if (!user) {
      // Uniform "no such OTP" message — leaks neither account
      // existence nor whether the email was a typo.
      throw new UnauthorizedAppException('Invalid or expired verification code');
    }

    if (user.status === 'ACTIVE' && user.emailVerified) {
      throw new BadRequestAppException(
        'This account is already verified. Please sign in.',
        'ALREADY_VERIFIED',
      );
    }

    if (user.status !== 'PENDING_VERIFICATION') {
      // SUSPENDED / BANNED / INACTIVE. We do not let a verify call
      // un-suspend an account — that path is admin-only. Treat as
      // generic "cannot verify."
      throw new UnauthorizedAppException(
        'Invalid or expired verification code',
      );
    }

    const otpRecord = await this.userRepo.findActiveEmailVerificationOtp(
      user.id,
    );
    if (!otpRecord) {
      throw new UnauthorizedAppException(
        'Invalid or expired verification code',
      );
    }

    // Atomic check-and-increment. Same pattern as verify-reset-otp:
    // the WHERE clause expresses "still active AND attempts<cap"
    // atomically, so concurrent verify requests can't both pass.
    const inc = await this.userRepo.incrementEmailVerificationOtpAttemptsCas(
      otpRecord.id,
      otpRecord.maxAttempts,
    );
    if (!inc.ok) {
      // Either the row was already expired/verified by a concurrent
      // request, or the attempts cap was already hit. Expire
      // defensively so subsequent verifies don't probe a stale row.
      await this.userRepo.expireEmailVerificationOtp(otpRecord.id);
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new verification code.',
      );
    }

    // Constant-time comparison. Both inputs are 64-char hex strings
    // from sha256, so length equality is guaranteed, but the explicit
    // guard keeps timingSafeEqual safe if the storage format ever
    // changes.
    const candidateHash = createHash('sha256').update(otp).digest('hex');
    const candidate = Buffer.from(candidateHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected);

    if (!isMatch) {
      const remaining = otpRecord.maxAttempts - inc.attempts;
      if (remaining <= 0) {
        await this.userRepo.expireEmailVerificationOtp(otpRecord.id);
        throw new UnauthorizedAppException(
          'Too many failed attempts. Please request a new verification code.',
        );
      }
      throw new UnauthorizedAppException(
        `Invalid verification code. ${remaining} attempt(s) remaining.`,
      );
    }

    // OTP matches. Consume + activate atomically.
    await this.userRepo.markEmailVerified(otpRecord.id, user.id);

    // Fire the downstream event so the email handler can send a
    // welcome message + analytics receivers can record the
    // activation. Best-effort: the user is already ACTIVE in DB.
    this.eventBus
      .publish({
        eventName: 'identity.user.email_verified',
        aggregate: 'user',
        aggregateId: user.id,
        occurredAt: new Date(),
        payload: { userId: user.id, email: user.email },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to publish identity.user.email_verified for ${user.id}: ${err}`,
        );
      });

    this.logger.log(`Customer email verified: ${user.id}`);

    return {
      email: user.email,
      verified: true,
    };
  }
}
