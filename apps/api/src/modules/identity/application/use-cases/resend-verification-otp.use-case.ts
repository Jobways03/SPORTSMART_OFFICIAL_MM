import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { ResendVerificationOtpResponseData } from '../../presentation/dtos/auth-response.dto';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';

interface ResendVerificationOtpInput {
  email: string;
}

/**
 * Phase 16 (2026-05-20) — Customer registration: resend OTP.
 *
 * Mirrors the resend-reset-otp pattern: always returns a uniform
 * "if you have an unverified account we sent a new code" payload so
 * the public API never reveals whether the email is registered or
 * whether it's in PENDING_VERIFICATION state. Internal logic:
 *
 *   1. Find the user. If absent, simulate timing and return.
 *   2. If status is anything other than PENDING_VERIFICATION (eg
 *      already ACTIVE), simulate timing and return — the user is
 *      already verified, no resend needed, and no enumeration leak
 *      via differential timing.
 *   3. Enforce server-side 60-second cooldown against any active OTP.
 *      Combined with the 1/min/IP throttle, this defeats both
 *      single-IP and IP-rotating spam.
 *   4. Invalidate the previous active OTP (set expiresAt = now).
 *   5. Generate a new 6-digit OTP, persist the hash, emit
 *      identity.user.verification_otp_requested with the plaintext.
 */
@Injectable()
export class ResendVerificationOtpUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;
  // Phase 27 (2026-05-21) — per-user hourly resend cap. Mirrors the
  // affiliate password-reset + Phase-26 customer password-reset
  // pattern. Defends against email-flooding for a known target
  // email: the 60-second cooldown alone permitted 60 resends/hour.
  // Applied silently — same enumeration-safety stance as the cooldown
  // branch (return uniformResponse without sending).
  private static readonly MAX_RESENDS_PER_HOUR = 5;

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResendVerificationOtpUseCase');
  }

  async execute(
    input: ResendVerificationOtpInput,
  ): Promise<ResendVerificationOtpResponseData> {
    const { email } = input;

    const uniformResponse: ResendVerificationOtpResponseData = {
      email,
      message:
        'If your email is awaiting verification, a new 6-digit code has been sent.',
    };

    const user = await this.userRepo.findByEmailForVerification(email);

    // Resend only when the account exists, is NOT already verified, and is in
    // a verifiable state. Email verification is tracked by `emailVerified`,
    // not by status — customers are created ACTIVE (the PENDING_VERIFICATION
    // state is never wired), so the old `status === PENDING_VERIFICATION`
    // gate silently no-oped for every customer. Allow ACTIVE/PENDING; refuse
    // already-verified or disabled accounts.
    const verifiable =
      !!user &&
      !user.emailVerified &&
      (user.status === 'ACTIVE' || user.status === 'PENDING_VERIFICATION');
    if (!verifiable) {
      // No user, already verified, or disabled. Simulate the timing of the
      // create path so an enumeration probe can't distinguish the branches
      // by response latency.
      await this.simulateDelay();
      return uniformResponse;
    }

    const recent = await this.userRepo.findRecentEmailVerificationOtp(
      user.id,
      ResendVerificationOtpUseCase.COOLDOWN_SECONDS,
    );
    if (recent) {
      // Within cooldown — silently return without issuing a new code.
      // The user sees the same uniform message so they don't get a
      // signal to "spam click harder."
      return uniformResponse;
    }

    // Phase 27 (2026-05-21) — hourly resend cap. Silent drop on hit
    // (uniform message); the per-IP throttle at the controller layer
    // is the loud rejection.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.userRepo.countEmailVerificationOtpsSince(
      user.id,
      oneHourAgo,
    );
    if (recentCount >= ResendVerificationOtpUseCase.MAX_RESENDS_PER_HOUR) {
      return uniformResponse;
    }

    await this.userRepo.invalidateActiveEmailVerificationOtps(user.id);

    const otpPlaintext = String(randomInt(100000, 1_000_000));
    const otpHash = createHash('sha256').update(otpPlaintext).digest('hex');
    const otpExpiresAt = new Date(
      Date.now() + ResendVerificationOtpUseCase.OTP_EXPIRY_MINUTES * 60 * 1000,
    );

    await this.userRepo.createEmailVerificationOtp(
      user.id,
      otpHash,
      otpExpiresAt,
    );

    // Fire the same event shape as initial registration so a single
    // email handler dispatches both. Distinct eventName so analytics
    // can separate "first OTP" from "resent OTP" if needed.
    this.eventBus
      .publish({
        eventName: 'identity.user.verification_otp_requested',
        aggregate: 'user',
        aggregateId: user.id,
        occurredAt: new Date(),
        payload: {
          userId: user.id,
          email: user.email,
          otpPlaintext,
          otpExpiresAt: otpExpiresAt.toISOString(),
          reason: 'resend',
        },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to publish identity.user.verification_otp_requested for ${user.id}: ${err}`,
        );
      });

    this.logger.log(`Verification OTP resent for user: ${user.id}`);

    return uniformResponse;
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
