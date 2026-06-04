import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';

interface VerifyResetOtpInput {
  email: string;
  otp: string;
  // Phase 207 (#3) — optional request context so the OTP verify outcome
  // can be written to access_logs for the brute-force detectors. Optional
  // because the calling controller doesn't (yet) thread IP/UA; when it
  // does, the spike detector gets per-IP attribution for OTP guessing too.
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface VerifyResetOtpResult {
  resetToken: string;
}

@Injectable()
export class VerifyResetOtpUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly logger: AppLoggerService,
    // Phase 207 (#3) — access-log is @Global so injecting it here adds no
    // module wiring. Used to record OTP_VERIFY_SUCCESS / OTP_VERIFY_FAILED.
    private readonly accessLog: AccessLogService,
  ) {
    this.logger.setContext('VerifyResetOtpUseCase');
  }

  /**
   * Phase 207 (#3) — write the OTP verify outcome to access_logs so the
   * brute-force spike detectors can see reset-OTP guessing. Best-effort:
   * a logging failure must never change the verify result the caller sees.
   * For a failure on an unknown email we attribute by the attempted email
   * (no userId exists), mirroring the LOGIN_FAILURE convention; for a known
   * user, by user.id so it joins the customer's own history.
   */
  private recordOtpOutcome(args: {
    succeeded: boolean;
    actorId: string;
    input: VerifyResetOtpInput;
    reason?: string;
  }): void {
    this.accessLog
      .record({
        actorType: 'CUSTOMER',
        actorId: args.actorId,
        kind: args.succeeded ? 'OTP_VERIFY_SUCCESS' : 'OTP_VERIFY_FAILED',
        ipAddress: args.input.ipAddress ?? null,
        userAgent: args.input.userAgent ?? null,
        succeeded: args.succeeded,
        reason: args.reason,
      })
      .catch(() => undefined);
  }

  async execute(input: VerifyResetOtpInput): Promise<VerifyResetOtpResult> {
    const { email, otp } = input;

    const user = await this.userRepo.findByEmail(email) as any;

    if (!user) {
      // Attribute the failure by the attempted email so reconnaissance
      // against unknown accounts is still visible to the spike detector.
      this.recordOtpOutcome({
        succeeded: false,
        actorId: email,
        input,
        reason: 'unknown_email',
      });
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Phase 26 (2026-05-20) — re-check status at verify time. The
    // forgot-password use case rejects non-ACTIVE accounts up front,
    // but admin may have suspended the account between the OTP send
    // and the verify. Without this check, a suspended user completes
    // the verify and burns a reset-token slot that the subsequent
    // login attempt would reject anyway. Matches admin reset behaviour.
    if (user.status !== 'ACTIVE') {
      this.recordOtpOutcome({
        succeeded: false,
        actorId: user.id,
        input,
        reason: 'account_not_active',
      });
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Find the latest unexpired, unused OTP for this user
    const otpRecord = await this.userRepo.findActiveOtp(user.id);

    if (!otpRecord) {
      this.recordOtpOutcome({
        succeeded: false,
        actorId: user.id,
        input,
        reason: 'no_active_otp',
      });
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Phase 1 / H5 — atomic check-and-increment. The previous
    // read-then-increment pattern let two concurrent verifies both
    // observe `attempts = 0`, both pass the `< maxAttempts` check,
    // both run their increments → attempts undercounted relative to
    // requests, and a brute-force attacker could trade rate-limit
    // budget for extra guesses. The CAS variant atomically refuses
    // the increment when the cap is already reached.
    const inc = await this.userRepo.incrementOtpAttemptsCas(
      otpRecord.id,
      otpRecord.maxAttempts,
    );
    if (!inc.ok) {
      await this.userRepo.expireOtp(otpRecord.id);
      this.recordOtpOutcome({
        succeeded: false,
        actorId: user.id,
        input,
        reason: 'attempts_exhausted',
      });
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new OTP.',
      );
    }

    // Compare OTP hash in constant time. Both values are 64-char hex
    // strings from sha256 so lengths always match, but the explicit
    // length guard keeps us safe if the storage format ever changes.
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const actual = Buffer.from(otpHash, 'utf8');
    const expected = Buffer.from(otpRecord.otpHash, 'utf8');
    const isMatch =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!isMatch) {
      const remainingAttempts = otpRecord.maxAttempts - inc.attempts;
      this.recordOtpOutcome({
        succeeded: false,
        actorId: user.id,
        input,
        reason: 'invalid_otp',
      });
      if (remainingAttempts <= 0) {
        // Expire after last failed attempt
        await this.userRepo.expireOtp(otpRecord.id);
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP is valid -- generate reset token
    const resetToken = randomUUID();

    await this.userRepo.markOtpVerified(otpRecord.id, resetToken);

    this.recordOtpOutcome({ succeeded: true, actorId: user.id, input });
    this.logger.log(`OTP verified for user: ${user.id}`);

    return { resetToken };
  }
}
