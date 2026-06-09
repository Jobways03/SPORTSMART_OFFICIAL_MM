import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  ADMIN_REPOSITORY,
  AdminRepository,
} from '../../../admin/domain/repositories/admin.repository.interface';
import { isBackupCodeFormat } from '../../domain/backup-codes';
import { generateTotpSecret } from '../../domain/totp-secret';
import { buildOtpAuthUri } from '../../domain/totp-uri';
import { verifyTotpCode } from '../../domain/totp-verify';
import { BackupCodesService } from './backup-codes.service';
import { MfaSecretCipher } from './mfa-secret-cipher.service';
import { randomInt, createHash } from 'crypto';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';

/**
 * Phase 10 (PR 10.4) + Phase 25 (2026-05-20) — Admin MFA enrolment
 * orchestration.
 *
 * Phase-25 additions on top of the original PR-10.4 surface:
 *   - Audit-log every MFA state transition (enrol begin/complete,
 *     step-up, disable, backup-code regenerate) via AuditPublicFacade.
 *     Pre-Phase-25 nothing was written, leaving a compliance gap:
 *     "when did admin X enrol MFA, when did backup code Y get used,
 *     when did MFA get disabled" — all invisible.
 *   - Emit `admin.mfa.*` events so the notifications module can
 *     send the admin an out-of-band email on every transition (the
 *     "your MFA was just enabled / disabled / a backup code was used"
 *     line is the only signal a victim of session-cookie theft sees
 *     before damage spreads).
 *   - Race-safe enrolment commit: instead of read-then-write, the
 *     final commit is an updateMany with `mfaEnabledAt: null` in the
 *     WHERE so two concurrent completes can't both succeed.
 *   - Pending-secret expiry: beginEnrollment stamps a 30-min TTL on
 *     the pending secret. The sweep cron clears expired pending rows
 *     so abandoned enrolments don't leave a recoverable secret
 *     indefinitely.
 *   - disable() + regenerateBackupCodes() + getStatus() methods that
 *     close the recovery / observability gap the original surface
 *     left.
 */

const MFA_PENDING_TTL_MS = 30 * 60 * 1000;

// Phase 26 (2026-05-20) — Step-up freshness window the StepUpGuard
// defaults to. Surface it from the service so the /step-up response
// can echo a stepUpExpiresAt the UI can count down to without having
// to know the guard's internal default.
const STEP_UP_DEFAULT_WINDOW_MS = 5 * 60 * 1000;

// Email-OTP step-up — an ALTERNATIVE to the TOTP/backup code for elevating a
// session. The admin requests a 6-digit code by email; its SHA-256 hash is held
// in Redis keyed by the SESSION (so it only elevates the requesting session) and
// expires with the step-up window. Unlike TOTP step-up it does NOT require MFA
// enrollment — it's the path for admins who use email codes.
const STEP_UP_EMAIL_OTP_TTL_SECONDS = 300;
const STEP_UP_EMAIL_OTP_COOLDOWN_SECONDS = 60;
const STEP_UP_EMAIL_OTP_MAX_ATTEMPTS = 5;
const stepUpEmailOtpKey = (sessionId: string) =>
  `admin:mfa:stepup:emailotp:${sessionId}`;
const stepUpEmailOtpCooldownKey = (sessionId: string) =>
  `admin:mfa:stepup:emailotp:cooldown:${sessionId}`;
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  const head = user.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AdminMfaService {
  private readonly logger = new Logger(AdminMfaService.name);

  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly cipher: MfaSecretCipher,
    private readonly env: EnvService,
    private readonly backupCodes: BackupCodesService,
    private readonly audit: AuditPublicFacade,
    private readonly events: EventEmitter2,
    private readonly redis: RedisService,
    private readonly emailOtp: EmailOtpAdapter,
  ) {}

  async beginEnrollment(
    adminId: string,
    ctx: RequestContext = { ipAddress: null, userAgent: null },
  ): Promise<{ otpAuthUrl: string; secret: string }> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      email: true,
      mfaEnabledAt: true,
    });
    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }
    if (admin.mfaEnabledAt) {
      throw new ConflictAppException(
        'Admin already has MFA enrolled. Disable existing MFA before re-enrolling.',
      );
    }
    if (!admin.email) {
      // Defensive: the select asked for email so an admin without one
      // is a data-integrity issue. The otpauth label requires the
      // account identifier.
      throw new BadRequestAppException(
        'Admin has no email on record; cannot build otpauth label',
      );
    }

    const secret = generateTotpSecret();
    const ciphertext = this.cipher.encrypt(secret);

    const issuer = this.env.getString('APP_NAME', 'SportsMart');
    const otpAuthUrl = buildOtpAuthUri({
      issuer,
      account: admin.email,
      secret,
    });

    // Phase 25 — stamp a 30-min expiry on the pending secret so the
    // sweep cron can clean up abandoned enrolments. Overwriting any
    // previous `mfaPendingSecretCiphertext` is fine — restarting
    // enrolment discards the previous attempt (the user explicitly
    // chose to start over).
    await this.adminRepo.updateAdmin(adminId, {
      mfaPendingSecretCiphertext: ciphertext,
      mfaPendingExpiresAt: new Date(Date.now() + MFA_PENDING_TTL_MS),
    });

    await this.writeAudit({
      adminId,
      action: 'admin.mfa.enrolment_started',
      newValue: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    this.emit('admin.mfa.enrolment_started', adminId, {
      adminId,
      email: admin.email,
      ...ctx,
    });

    return { otpAuthUrl, secret };
  }

  async completeEnrollment(
    adminId: string,
    code: string,
    ctx: RequestContext = { ipAddress: null, userAgent: null },
  ): Promise<{ backupCodes: string[] }> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      email: true,
      mfaPendingSecretCiphertext: true,
      mfaPendingExpiresAt: true,
      mfaEnabledAt: true,
    });
    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }
    if (admin.mfaEnabledAt) {
      throw new ConflictAppException('Admin already has MFA enrolled');
    }
    if (!admin.mfaPendingSecretCiphertext) {
      throw new BadRequestAppException(
        'No MFA enrollment in progress; call beginEnrollment first',
      );
    }
    // Phase 25 — refuse to consume a pending secret that has aged
    // past the TTL. The sweep cron is the durable cleaner, but
    // checking here closes the window between expiry and the next
    // sweep. Reading mfaPendingExpiresAt as `any` because the
    // generated Prisma types lag the schema until `prisma generate`.
    const pendingExpiresAt = (admin as any).mfaPendingExpiresAt as
      | Date
      | null
      | undefined;
    if (pendingExpiresAt && pendingExpiresAt.getTime() < Date.now()) {
      await this.adminRepo.updateAdmin(adminId, {
        mfaPendingSecretCiphertext: null,
        mfaPendingExpiresAt: null,
      });
      throw new BadRequestAppException(
        'MFA enrollment has expired; start over via /admin/mfa/enroll/begin',
      );
    }

    // Decrypt — throws BadRequestAppException on key mismatch or
    // tampered ciphertext (handled at the controller layer as 400).
    const pendingSecret = this.cipher.decrypt(admin.mfaPendingSecretCiphertext);
    const result = verifyTotpCode({ secret: pendingSecret, code });
    if (!result.valid) {
      throw new BadRequestAppException(
        'Invalid TOTP code. Check your authenticator app and try again.',
      );
    }

    // Phase 25 — race-safe commit. The repo method runs an updateMany
    // guarded by `mfaEnabledAt: null`; only the FIRST of two parallel
    // completes sees count === 1. The other receives false and we
    // surface a 409 — without generating backup codes that would
    // overwrite the winner's set.
    const committed = this.adminRepo.commitMfaEnrollmentAtomic
      ? await this.adminRepo.commitMfaEnrollmentAtomic({
          adminId,
          pendingCiphertext: admin.mfaPendingSecretCiphertext,
          enabledAt: new Date(),
          lastUsedStep: result.step!,
        })
      : await this.legacyCommitFallback(
          adminId,
          admin.mfaPendingSecretCiphertext,
          result.step!,
        );
    if (!committed) {
      throw new ConflictAppException(
        'Another enrollment for this admin completed concurrently; refresh and verify your MFA status.',
      );
    }

    // PR 10.9 — generate + persist backup codes AFTER the live secret
    // is committed. Returns the cleartext codes ONCE to the caller.
    // Generating after the commit means a hypothetical bcrypt-hashing
    // failure leaves the admin enrolled-but-codeless rather than
    // blocking enrolment entirely — they can regenerate via the
    // /backup-codes/regenerate endpoint after step-up.
    const backupCodes = await this.backupCodes.generateAndHashForAdmin(adminId);

    await this.writeAudit({
      adminId,
      action: 'admin.mfa.enrolment_completed',
      newValue: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    this.emit('admin.mfa.enrolled', adminId, {
      adminId,
      email: admin.email,
      ...ctx,
    });

    return { backupCodes };
  }

  /**
   * Phase 10 (PR 10.10) — Step-up auth for destructive ops.
   *
   * Verifies a fresh TOTP (or backup code) and stamps the current
   * session's `stepUpVerifiedAt = now`. Routes decorated with
   * `@RequiresStepUp()` check that stamp via the StepUpGuard and
   * reject requests where it's null or older than the per-route
   * window (default 5min).
   */
  async stepUp(
    adminId: string,
    sessionId: string,
    code: string,
    ctx: RequestContext = { ipAddress: null, userAgent: null },
  ): Promise<{
    stepUpVerifiedAt: Date;
    stepUpExpiresAt: Date;
    usedBackupCode: boolean;
  }> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      email: true,
      mfaEnabledAt: true,
      mfaSecretCiphertext: true,
      mfaLastUsedStep: true,
    });
    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }

    // ── Email-OTP step-up path (alternative to TOTP/backup) ──────────────
    // If a step-up email code was requested for THIS session and the supplied
    // code matches, elevate immediately — no TOTP enrollment required. A wrong
    // code increments the attempt counter and (for a TOTP-enrolled admin) falls
    // through so they can still use their authenticator instead.
    const emailRec = await this.redis.get<{ otpHash: string; attempts: number }>(
      stepUpEmailOtpKey(sessionId),
    );
    if (emailRec) {
      const matches =
        createHash('sha256').update(code.trim()).digest('hex') === emailRec.otpHash;
      if (matches) {
        await this.redis.del(stepUpEmailOtpKey(sessionId));
        if (!this.adminRepo.markSessionStepUpVerified) {
          throw new BadRequestAppException(
            'Step-up persistence is unavailable on this repository binding',
          );
        }
        await this.adminRepo.markSessionStepUpVerified(sessionId);
        const verifiedAt = new Date();
        const expiresAt = new Date(verifiedAt.getTime() + STEP_UP_DEFAULT_WINDOW_MS);
        await this.writeAudit({
          adminId,
          action: 'admin.mfa.step_up_verified',
          newValue: {
            sessionId,
            method: 'email',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        this.emit('admin.mfa.step_up_verified', adminId, {
          adminId,
          email: admin.email,
          method: 'email',
          ...ctx,
        });
        return {
          stepUpVerifiedAt: verifiedAt,
          stepUpExpiresAt: expiresAt,
          usedBackupCode: false,
        };
      }
      const attempts = (emailRec.attempts ?? 0) + 1;
      if (attempts >= STEP_UP_EMAIL_OTP_MAX_ATTEMPTS) {
        await this.redis.del(stepUpEmailOtpKey(sessionId));
      } else {
        await this.redis.set(
          stepUpEmailOtpKey(sessionId),
          { otpHash: emailRec.otpHash, attempts },
          STEP_UP_EMAIL_OTP_TTL_SECONDS,
        );
      }
      // No TOTP fallback possible for a non-enrolled admin → fail clearly.
      if (!admin.mfaEnabledAt || !admin.mfaSecretCiphertext) {
        throw new BadRequestAppException(
          'Invalid email code. Check your inbox or request a new code.',
        );
      }
      // else: fall through — the admin may be entering their TOTP code instead.
    }

    if (!admin.mfaEnabledAt || !admin.mfaSecretCiphertext) {
      throw new BadRequestAppException(
        'Step-up requires MFA enrollment. Enroll first via /admin/mfa/enroll/begin, or use "Email me a code".',
      );
    }

    let stepToCommit: number | undefined;
    let usedBackupCode = false;
    if (isBackupCodeFormat(code)) {
      const consumed = await this.backupCodes.consume(adminId, code);
      if (!consumed) {
        throw new BadRequestAppException(
          'Invalid backup code. Use the codes from your enrollment-time download.',
        );
      }
      usedBackupCode = true;
    } else {
      const secret = this.cipher.decrypt(admin.mfaSecretCiphertext);
      const verify = verifyTotpCode({ secret, code });
      if (!verify.valid) {
        throw new BadRequestAppException(
          'Invalid TOTP code. Check your authenticator app and try again.',
        );
      }
      if (
        verify.step !== undefined &&
        admin.mfaLastUsedStep !== null &&
        admin.mfaLastUsedStep !== undefined &&
        verify.step <= admin.mfaLastUsedStep
      ) {
        throw new BadRequestAppException(
          'This TOTP code has already been used. Wait for the next code and try again.',
        );
      }
      stepToCommit = verify.step;
    }

    // Phase 26 (2026-05-20) — Advance the anti-replay baseline ATOMICALLY
    // before stamping step-up. Pre-Phase-26 the TOTP path wrote
    // mfaLastUsedStep via plain updateAdmin, so two concurrent step-up
    // calls presenting the same captured TOTP code could both succeed
    // and elevate two sessions. The login-time verify-challenge path
    // already uses advanceMfaLastUsedStepCas for this; the step-up path
    // does too now. Backup-code use stays out of the CAS path because
    // backup-codes are single-use via hash-splice (with a Redis lock),
    // which is the equivalent anti-replay mechanism.
    if (stepToCommit !== undefined) {
      const advanced = await this.adminRepo.advanceMfaLastUsedStepCas(
        adminId,
        stepToCommit,
      );
      if (!advanced) {
        throw new BadRequestAppException(
          'This TOTP code has already been used. Wait for the next code and try again.',
        );
      }
    }

    if (!this.adminRepo.markSessionStepUpVerified) {
      throw new BadRequestAppException(
        'Step-up persistence is unavailable on this repository binding',
      );
    }
    await this.adminRepo.markSessionStepUpVerified(sessionId);

    const stepUpVerifiedAt = new Date();
    const stepUpExpiresAt = new Date(
      stepUpVerifiedAt.getTime() + STEP_UP_DEFAULT_WINDOW_MS,
    );

    await this.writeAudit({
      adminId,
      action: 'admin.mfa.step_up_verified',
      newValue: {
        sessionId,
        usedBackupCode,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    if (usedBackupCode) {
      this.emit('admin.mfa.backup_code_consumed', adminId, {
        adminId,
        email: admin.email,
        context: 'step_up',
        ...ctx,
      });
    } else {
      this.emit('admin.mfa.step_up_verified', adminId, {
        adminId,
        email: admin.email,
        ...ctx,
      });
    }
    return { stepUpVerifiedAt, stepUpExpiresAt, usedBackupCode };
  }

  /**
   * Email-OTP step-up — step A. Generate a 6-digit code, stash its SHA-256 hash
   * in Redis keyed by the session, and email it to the admin. The code is then
   * accepted by stepUp() (above). Requires only an active, authenticated admin
   * with an email — NOT TOTP enrollment — so it's the no-authenticator path.
   */
  async requestStepUpEmailOtp(
    adminId: string,
    sessionId: string,
    ctx: RequestContext = { ipAddress: null, userAgent: null },
  ): Promise<{ otpExpiresIn: number; maskedEmail: string }> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      email: true,
      role: true,
      status: true,
    } as any);
    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }
    if ((admin as any).status !== 'ACTIVE') {
      throw new BadRequestAppException('Admin account is not active');
    }
    if (!admin.email) {
      throw new BadRequestAppException('Admin has no email on record.');
    }

    // Per-session cooldown so the "email me a code" button can't be spammed.
    const cooled = await this.redis.acquireLock(
      stepUpEmailOtpCooldownKey(sessionId),
      STEP_UP_EMAIL_OTP_COOLDOWN_SECONDS,
    );
    if (!cooled) {
      throw new BadRequestAppException(
        'A code was just sent. Please wait a moment before requesting another.',
      );
    }

    const otp = String(randomInt(100000, 1000000));
    const otpHash = createHash('sha256').update(otp).digest('hex');
    await this.redis.set(
      stepUpEmailOtpKey(sessionId),
      { otpHash, attempts: 0 },
      STEP_UP_EMAIL_OTP_TTL_SECONDS,
    );

    const sent = await this.emailOtp.sendOtp(admin.email, otp).catch((err) => {
      this.logger.error(
        `Failed to send admin step-up email OTP: ${(err as Error)?.message}`,
      );
      return false;
    });
    if (!sent) {
      // Don't leave a code the admin can never see — drop it.
      await this.redis.del(stepUpEmailOtpKey(sessionId));
      throw new BadRequestAppException(
        'Could not send the email code right now. Please try again shortly.',
      );
    }

    await this.writeAudit({
      adminId,
      action: 'admin.mfa.step_up_email_otp_sent',
      newValue: { sessionId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    return {
      otpExpiresIn: STEP_UP_EMAIL_OTP_TTL_SECONDS,
      maskedEmail: maskEmail(admin.email),
    };
  }

  /**
   * Phase 25 (2026-05-20) — Read-only MFA status for the calling admin.
   * Used by /admin/mfa/status to render "MFA: On • N backup codes left"
   * without an extra service trip.
   */
  async getStatus(adminId: string): Promise<{
    enabled: boolean;
    enrolledAt: Date | null;
    backupCodesRemaining: number;
    pendingEnrolment: boolean;
  }> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      mfaEnabledAt: true,
      mfaPendingSecretCiphertext: true,
      mfaBackupCodesHashes: true,
    });
    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }
    const hashes = (admin.mfaBackupCodesHashes as string[] | null) ?? [];
    return {
      enabled: !!admin.mfaEnabledAt,
      enrolledAt: admin.mfaEnabledAt ?? null,
      backupCodesRemaining: hashes.length,
      pendingEnrolment: !!admin.mfaPendingSecretCiphertext,
    };
  }

  /**
   * Phase 25 (2026-05-20) — Disable MFA on the calling admin's own
   * account. Step-up gated at the controller layer; this method
   * assumes the controller verified a fresh elevation. Clears every
   * MFA column so /enroll/begin starts cleanly afterwards.
   *
   * Side effects: writes an audit row + emits `admin.mfa.disabled`
   * so the admin gets an out-of-band notification. The
   * notification is the load-bearing security signal — a victim of
   * session-cookie theft sees "your MFA was just disabled" in their
   * inbox before the attacker can complete a fresh enrolment.
   */
  async disable(
    adminId: string,
    ctx: RequestContext = { ipAddress: null, userAgent: null },
  ): Promise<void> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      email: true,
      mfaEnabledAt: true,
    });
    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }
    if (!admin.mfaEnabledAt) {
      throw new BadRequestAppException(
        'MFA is not enabled on this account; nothing to disable.',
      );
    }
    await this.adminRepo.updateAdmin(adminId, {
      mfaSecretCiphertext: null,
      mfaPendingSecretCiphertext: null,
      mfaPendingExpiresAt: null,
      mfaEnabledAt: null,
      mfaBackupCodesHashes: null,
      mfaLastUsedStep: null,
    });

    await this.writeAudit({
      adminId,
      action: 'admin.mfa.disabled',
      oldValue: { mfaEnabledAt: admin.mfaEnabledAt },
      newValue: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    this.emit('admin.mfa.disabled', adminId, {
      adminId,
      email: admin.email,
      ...ctx,
    });
  }

  /**
   * Phase 25 (2026-05-20) — Regenerate backup codes. Overwrites the
   * existing hash array in place so the old codes can no longer
   * match. Step-up gated at the controller layer.
   */
  async regenerateBackupCodes(
    adminId: string,
    ctx: RequestContext = { ipAddress: null, userAgent: null },
  ): Promise<{ backupCodes: string[] }> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      email: true,
      mfaEnabledAt: true,
    });
    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }
    if (!admin.mfaEnabledAt) {
      throw new BadRequestAppException(
        'Cannot regenerate backup codes — MFA is not enabled on this account.',
      );
    }
    const backupCodes = await this.backupCodes.generateAndHashForAdmin(adminId);

    await this.writeAudit({
      adminId,
      action: 'admin.mfa.backup_codes_regenerated',
      newValue: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    this.emit('admin.mfa.backup_codes_regenerated', adminId, {
      adminId,
      email: admin.email,
      ...ctx,
    });
    return { backupCodes };
  }

  // Phase 25 — repository fallback when the binding hasn't implemented
  // commitMfaEnrollmentAtomic (test stubs, in-memory mocks). The fallback
  // is NOT race-safe, but a test stub by definition serializes calls.
  private async legacyCommitFallback(
    adminId: string,
    pendingCiphertext: string,
    step: number,
  ): Promise<boolean> {
    await this.adminRepo.updateAdmin(adminId, {
      mfaSecretCiphertext: pendingCiphertext,
      mfaPendingSecretCiphertext: null,
      mfaPendingExpiresAt: null,
      mfaEnabledAt: new Date(),
      mfaLastUsedStep: step,
    });
    return true;
  }

  private async writeAudit(args: {
    adminId: string;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    try {
      await this.audit.writeAuditLog({
        actorId: args.adminId,
        actorRole: 'ADMIN',
        action: args.action,
        module: 'admin-mfa',
        resource: 'Admin',
        resourceId: args.adminId,
        oldValue: args.oldValue,
        newValue: args.newValue,
      });
    } catch (err) {
      // Audit write failure must NOT block the user-facing operation;
      // the operation already mutated DB state. Log loudly so ops can
      // backfill from logs if a downstream incident requires it.
      this.logger.error(
        `Failed to write MFA audit log (${args.action}, admin=${args.adminId}): ${
          (err as Error).message
        }`,
      );
    }
  }

  private emit(eventName: string, aggregateId: string, payload: unknown): void {
    try {
      this.events.emit(eventName, {
        eventName,
        aggregate: 'Admin',
        aggregateId,
        occurredAt: new Date(),
        payload,
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit ${eventName} for admin ${aggregateId}: ${
          (err as Error).message
        }`,
      );
    }
  }
}
