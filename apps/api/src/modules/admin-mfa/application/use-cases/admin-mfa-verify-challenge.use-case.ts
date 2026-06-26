import { Inject, Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID, randomInt, createHash, timingSafeEqual } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { AccessLogService } from '../../../access-log/application/services/access-log.service';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE_ADMIN,
} from '../../../../core/auth/jwt-constants';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import {
  ADMIN_REPOSITORY,
  AdminRepository,
} from '../../../admin/domain/repositories/admin.repository.interface';
import {
  ADMIN_MFA_CHALLENGE_AUD,
  AdminLoginSession,
} from '../../../admin/application/use-cases/admin-login.use-case';
import { isBackupCodeFormat } from '../../domain/backup-codes';
import { verifyTotpCode } from '../../domain/totp-verify';
import { BackupCodesService } from '../services/backup-codes.service';
import { MfaSecretCipher } from '../services/mfa-secret-cipher.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';

interface AdminMfaVerifyChallengeInput {
  challengeToken: string;
  code: string;
  userAgent?: string;
  ipAddress?: string;
}

const MFA_AUDIT_MODULE = 'admin-mfa';
const MFA_AUDIT_RESOURCE = 'AdminSession';

// Phase 26 (2026-05-20) — per-admin MFA brute-force lockout.
// Symmetric with the password lockout (MAX_FAILED_ATTEMPTS=5,
// LOCK_DURATION_MINUTES=15 in admin-login.use-case.ts). Defeats
// per-IP-throttle bypass via NAT / rotating proxies.
const MFA_MAX_FAILED_ATTEMPTS = 5;
const MFA_LOCK_DURATION_MS = 15 * 60 * 1000;

// Email-OTP MFA alternative (admin can request a 6-digit code by email
// instead of using their authenticator). The code lives in Redis keyed
// by the challenge `jti` so it's scoped to one login attempt.
const EMAIL_OTP_TTL_SECONDS = 300; // matches the 5-min challenge window
const EMAIL_OTP_COOLDOWN_SECONDS = 60; // min gap between sends per challenge
const EMAIL_OTP_MAX_ATTEMPTS = 5;

interface AdminMfaChallengeClaims {
  sub: string;
  email: string;
  aud: string;
  // Phase 26 (2026-05-20) — JTI for one-time-use enforcement. Older
  // challenge tokens (pre-Phase-26) may not carry one; the consume
  // step treats a missing JTI as "skip JTI tracking" rather than
  // failing closed, to avoid breaking in-flight challenges across
  // a deploy boundary.
  jti?: string;
}

/**
 * Phase 10 (PR 10.6) — second step of the MFA-gated admin login.
 *
 * The login use case (after password verification) returned a
 * short-lived challenge token. This use case:
 *
 *   1. Verifies the challenge token's signature, audience, expiry.
 *   2. Looks up the admin's encrypted MFA secret.
 *   3. Verifies the TOTP code against the decrypted secret.
 *   4. On success, mints the actual admin session (same shape as
 *      the non-MFA login success).
 *
 * Audience claim discipline: the challenge token has
 * `aud=admin-mfa-challenge`. The check `claims.aud !==
 * ADMIN_MFA_CHALLENGE_AUD` blocks any other JWT in the same
 * key-scope (session access tokens, refresh tokens, etc.) from
 * being mis-used as a challenge. Defence-in-depth on top of the
 * different `exp` windows.
 *
 * Anti-replay (closed 2026-05-16): TOTP codes carry a monotonic
 * `step` counter (unix_seconds / period). The verify path below
 * rejects codes for `step <= mfaLastUsedStep` (line ~156) and
 * advances the baseline on success (line ~182). Backup-code path
 * is single-use by construction (hash spliced on consume), so
 * mfaLastUsedStep is left untouched there.
 */
@Injectable()
export class AdminMfaVerifyChallengeUseCase {
  private readonly logger = new Logger(AdminMfaVerifyChallengeUseCase.name);

  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly envService: EnvService,
    private readonly cipher: MfaSecretCipher,
    private readonly backupCodes: BackupCodesService,
    // Phase 23 (2026-05-20) — audit + event hooks. Every MFA verify
    // outcome (success / wrong-code / replay / backup-code-used) lands
    // in the unified AuditLog so incident response can answer "who
    // tried MFA, when, from where, with what result". Backup-code use
    // additionally fires admin.mfa.backup_code_used so the email
    // notification handler can warn the admin out-of-band.
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
    // Phase 26 (2026-05-20) — writes the LOGIN_SUCCESS row to
    // access_log on MFA-pass so admins with MFA enrolled don't drop
    // off the new-device / spike detectors that walk that table.
    private readonly accessLog: AccessLogService,
    // Phase 26 — one-time-use enforcement for challenge JTI. SET NX
    // EX on the challenge consume path: first verify wins; replay 401s.
    private readonly redis: RedisService,
    // Email-OTP MFA alternative — sends the 6-digit login code by email.
    private readonly emailOtp: EmailOtpAdapter,
  ) {}

  async execute(input: AdminMfaVerifyChallengeInput): Promise<AdminLoginSession> {
    const { challengeToken, code, userAgent, ipAddress } = input;

    // 1. Verify challenge JWT — surface a clean 401 for any failure.
    let claims: AdminMfaChallengeClaims;
    try {
      claims = jwt.verify(
        challengeToken,
        this.envService.getString('JWT_ADMIN_SECRET'),
        { algorithms: [JWT_ALGORITHM], audience: ADMIN_MFA_CHALLENGE_AUD },
      ) as AdminMfaChallengeClaims;
    } catch {
      throw new UnauthorizedAppException(
        'MFA challenge token is invalid or expired. Re-authenticate to obtain a new challenge.',
      );
    }

    // Phase 26 (2026-05-20) — one-time-use enforcement. The challenge
    // signs a `jti` claim; we SET NX EX on that key here. First
    // verify wins; replays (including with a fresh next-step TOTP)
    // are 401'd before any DB work. Falling open on no-JTI keeps
    // mid-deploy in-flight challenges working — older tokens lack
    // the claim entirely and only get the existing TOTP-step replay
    // defence.
    if (claims.jti) {
      const consumed = await this.redis.acquireLock(
        `admin:mfa:challenge:${claims.jti}`,
        // TTL slightly longer than the challenge expiry so a captured
        // token cannot be replayed after the JWT itself expires (the
        // jwt.verify above would already 401, but defence-in-depth).
        15 * 60,
      );
      if (!consumed) {
        this.writeAudit(
          claims.sub,
          null,
          'ADMIN_MFA_CHALLENGE_REPLAY',
          {
            jti: claims.jti,
            ipAddress,
            userAgent,
          },
        );
        throw new UnauthorizedAppException(
          'This MFA challenge has already been used. Re-authenticate to obtain a fresh challenge.',
        );
      }
    }

    // 2. Fetch admin's encrypted secret + enrollment timestamp.
    const admin = await this.adminRepo.findAdminById(claims.sub, {
      name: true,
      email: true,
      role: true,
      status: true,
      mfaSecretCiphertext: true,
      mfaEnabledAt: true,
      mfaLastUsedStep: true,
      // Phase 26 (2026-05-20) — per-admin MFA brute-force counter.
      failedMfaAttempts: true,
      mfaLockUntil: true,
    });
    if (!admin) {
      throw new UnauthorizedAppException('Admin not found');
    }
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Admin account is not active');
    }
    if (!admin.mfaEnabledAt || !admin.mfaSecretCiphertext) {
      // Edge case: admin un-enrolled MFA between login and verify.
      // Surface a clean error rather than letting decrypt explode on
      // a null ciphertext.
      throw new BadRequestAppException(
        'Admin no longer has MFA enrolled; re-authenticate to obtain a fresh session.',
      );
    }

    // Phase 26 (2026-05-20) — per-admin lockout check. The per-IP
    // throttle is in place at the controller layer (5/60s) but
    // breaks against NAT or rotating-proxy attackers; this
    // per-account counter closes that gap. 5 wrong codes in 15min
    // → mfaLockUntil set; subsequent verifies are 401'd until expiry.
    const mfaLockUntil = (admin as any).mfaLockUntil as Date | null | undefined;
    if (mfaLockUntil && mfaLockUntil.getTime() > Date.now()) {
      this.writeAudit(claims.sub, admin.role ?? null, 'ADMIN_MFA_LOCKED', {
        until: mfaLockUntil.toISOString(),
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedAppException(
        'MFA verification is temporarily locked for this account after too many failed attempts. Try again later.',
      );
    }

    // 3. Verify code. Dispatch on format: backup codes look like
    //    XXXXX-XXXXX (alphanumeric); TOTP codes are 6 digits.
    //    The split keeps the TOTP-vs-backup-code paths cleanly
    //    separated — backup codes don't have a "step" concept and
    //    don't participate in the mfaLastUsedStep anti-replay
    //    (they're single-use by construction: the matching hash
    //    is removed from the persisted list on consume).
    let stepToCommit: number | undefined;
    let usedBackupCode = false;
    if (isBackupCodeFormat(code)) {
      // PR 10.9 — backup-code recovery path. Used when the admin
      // has lost their authenticator device. BackupCodesService
      // bcrypt-matches against the stored hash list and removes
      // the consumed entry on success.
      const consumed = await this.backupCodes.consume(claims.sub, code);
      if (!consumed) {
        await this.bumpFailedAttempts(
          claims.sub,
          (admin as any).failedMfaAttempts as number | undefined,
          admin.role ?? null,
          'invalid_backup_code',
          ipAddress,
          userAgent,
        );
        throw new UnauthorizedAppException(
          'Invalid backup code. If you have run out of backup codes, contact an admin with full account rights for manual recovery.',
        );
      }
      usedBackupCode = true;
      // stepToCommit stays undefined — backup-code use doesn't
      // advance mfaLastUsedStep (no step to record).
    } else {
      const secret = this.cipher.decrypt(admin.mfaSecretCiphertext);
      const verify = verifyTotpCode({ secret, code });
      if (!verify.valid) {
        await this.bumpFailedAttempts(
          claims.sub,
          (admin as any).failedMfaAttempts as number | undefined,
          admin.role ?? null,
          'invalid_totp',
          ipAddress,
          userAgent,
        );
        throw new UnauthorizedAppException(
          'Invalid TOTP code. Check your authenticator app and try again.',
        );
      }

      // PR 10.7 — anti-replay. The TOTP step counter is monotonic
      // (unix_seconds / period). Rejecting codes for step <=
      // mfaLastUsedStep closes the replay window.
      if (
        verify.step !== undefined &&
        admin.mfaLastUsedStep !== null &&
        admin.mfaLastUsedStep !== undefined &&
        verify.step <= admin.mfaLastUsedStep
      ) {
        this.writeAudit(
          claims.sub,
          admin.role ?? null,
          'ADMIN_MFA_REPLAY_DETECTED',
          {
            attemptedStep: verify.step,
            lastUsedStep: admin.mfaLastUsedStep,
            ipAddress,
            userAgent,
          },
        );
        throw new UnauthorizedAppException(
          'This TOTP code has already been used. Wait for the next code from your authenticator app and try again.',
        );
      }
      stepToCommit = verify.step;
    }

    // 4. Mint the session. Mirrors AdminLoginUseCase's success path
    //    intentionally — keeping the two in lockstep is a Phase 10
    //    correctness concern: if a future PR adds a session-creation
    //    side-effect (e.g. session-rate-limit row), both paths
    //    inherit it.
    // PR 10.7 / 10.9 — advance the anti-replay baseline only on
    // TOTP success. Backup-code consume doesn't have a step to
    // record; the consumed hash being spliced out of the persisted
    // list is the anti-replay mechanism for that path.
    //
    // Phase 1 / H3 — the step advance now goes through the atomic
    // CAS variant so two concurrent verifies presenting the same
    // TOTP code cannot both win. If the CAS fails (returns false),
    // another verify already advanced past this step → replay.
    if (stepToCommit !== undefined) {
      const advanced = await this.adminRepo.advanceMfaLastUsedStepCas(
        claims.sub,
        stepToCommit,
      );
      if (!advanced) {
        this.writeAudit(
          claims.sub,
          admin.role ?? null,
          'ADMIN_MFA_REPLAY_DETECTED',
          {
            attemptedStep: stepToCommit,
            reason: 'cas_failed',
            ipAddress,
            userAgent,
          },
        );
        throw new UnauthorizedAppException(
          'This TOTP code has already been used. Wait for the next code from your authenticator app and try again.',
        );
      }
    }
    await this.adminRepo.updateAdmin(claims.sub, {
      lastLoginAt: new Date(),
      // Phase 26 (2026-05-20) — reset the MFA brute-force counter on
      // every successful verify. Mirrors AdminLoginUseCase clearing
      // failedLoginAttempts when the password succeeds.
      failedMfaAttempts: 0,
      mfaLockUntil: null,
    });

    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(
      this.envService.getString('JWT_REFRESH_TTL', '30d'),
    );
    const session = await this.adminRepo.createAdminSession({
      adminId: claims.sub,
      refreshToken,
      userAgent: userAgent || null,
      ipAddress: ipAddress || null,
      expiresAt: new Date(Date.now() + refreshTtl),
    });

    // Phase 23 (2026-05-20) — fallback tightened from '7d' → '15m'.
    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '15m');
    const accessTtlSeconds = Math.floor(this.parseTimeToMs(accessTtl) / 1000);
    const accessToken = jwt.sign(
      {
        sub: claims.sub,
        email: admin.email,
        role: admin.role,
        sessionId: session.id,
      },
      this.envService.getString('JWT_ADMIN_SECRET'),
      {
        expiresIn: accessTtlSeconds,
        algorithm: JWT_ALGORITHM,
        // Phase 26 (2026-05-20) — audience pin parity with the
        // non-MFA login token; AdminAuthGuard requires this.
        audience: JWT_AUDIENCE_ADMIN,
      },
    );

    // Phase 26 (2026-05-20) — write the LOGIN_SUCCESS row to
    // access_log here, post-MFA. Pre-Phase-26 AdminAuthController.login
    // wrote LOGIN_SUCCESS unconditionally for any response carrying an
    // adminId, including the challenge-only halt; that gave MFA-enrolled
    // admins a misleading LOGIN_SUCCESS row at the password step.
    // Phase 26 split: login writes LOGIN_SUCCESS only for non-MFA;
    // verify writes it for the MFA path. Best-effort — audit completeness
    // never blocks a successful authentication.
    this.accessLog
      .record({
        actorType: 'ADMIN',
        actorId: claims.sub,
        actorRole: admin.role ?? null,
        kind: 'LOGIN_SUCCESS',
        ipAddress,
        userAgent,
      })
      .catch(() => undefined);

    // Phase 207 (#3) — explicit second-factor success row so the access
    // log carries the MFA outcome distinctly from the session-mint
    // LOGIN_SUCCESS. metadata records whether a backup code was used.
    this.accessLog
      .record({
        actorType: 'ADMIN',
        actorId: claims.sub,
        actorRole: admin.role ?? null,
        kind: 'MFA_VERIFY_SUCCESS',
        ipAddress,
        userAgent,
        metadata: { usedBackupCode },
      })
      .catch(() => undefined);

    // Phase 23 (2026-05-20) — audit log + event hooks on success.
    if (usedBackupCode) {
      this.writeAudit(
        claims.sub,
        admin.role ?? null,
        'ADMIN_MFA_BACKUP_CODE_USED',
        { sessionId: session.id, ipAddress, userAgent },
      );
      // Fire an event so the email notification handler can warn the
      // admin out-of-band that a backup code was used — recovery
      // signal worth surfacing to the affected admin.
      this.eventBus
        .publish({
          eventName: 'admin.mfa.backup_code_used',
          aggregate: 'admin',
          aggregateId: claims.sub,
          occurredAt: new Date(),
          payload: {
            adminId: claims.sub,
            email: admin.email ?? null,
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
          },
        })
        .catch(() => undefined);
    } else {
      this.writeAudit(claims.sub, admin.role ?? null, 'ADMIN_MFA_SUCCESS', {
        sessionId: session.id,
        ipAddress,
        userAgent,
      });
      // Phase 26 (2026-05-20) — notify admin out-of-band on every
      // successful TOTP-MFA login. Pre-Phase-26 only backup-code use
      // notified; an attacker who phished password + TOTP could
      // log in repeatedly without the legitimate admin seeing a
      // signal. The email is the side-channel "your account was
      // accessed at T from IP X" warning. Best-effort; never
      // blocks the login.
      this.eventBus
        .publish({
          eventName: 'admin.mfa.login_succeeded',
          aggregate: 'admin',
          aggregateId: claims.sub,
          occurredAt: new Date(),
          payload: {
            adminId: claims.sub,
            email: admin.email ?? null,
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
            sessionId: session.id,
          },
        })
        .catch(() => undefined);
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      admin: {
        adminId: claims.sub,
        name: admin.name ?? '',
        email: admin.email ?? '',
        role: admin.role ?? '',
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Email-OTP MFA path — an ALTERNATIVE second factor to TOTP/backup at
  // the same challenge step. The admin requests a 6-digit code by email
  // and submits it. The OTP is stored in Redis keyed by the challenge
  // `jti` (scoped to a single login attempt, expires with the window).
  // On success the challenge JTI is consumed and the SAME session shape
  // as the TOTP path is minted (mintSession).
  // ──────────────────────────────────────────────────────────────────

  /**
   * Step A — generate a 6-digit OTP, stash its SHA-256 hash in Redis
   * keyed by the challenge jti, and email it to the admin. Requires a
   * valid (un-consumed) challenge; does NOT consume the jti (that
   * happens on successful verify so the admin can retry the code).
   */
  async requestEmailOtp(input: {
    challengeToken: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ otpExpiresIn: number }> {
    const claims = this.verifyChallengeToken(input.challengeToken);
    if (!claims.jti) {
      throw new BadRequestAppException(
        'This challenge does not support email codes; re-authenticate to obtain a fresh challenge.',
      );
    }
    const admin = await this.adminRepo.findAdminById(claims.sub, {
      email: true,
      role: true,
      status: true,
      mfaEnabledAt: true,
      mfaLockUntil: true,
    });
    if (!admin) throw new UnauthorizedAppException('Admin not found');
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Admin account is not active');
    }
    if (!admin.mfaEnabledAt) {
      throw new BadRequestAppException(
        'Admin no longer has MFA enrolled; re-authenticate to obtain a fresh session.',
      );
    }
    const lockUntil = (admin as any).mfaLockUntil as Date | null | undefined;
    if (lockUntil && lockUntil.getTime() > Date.now()) {
      throw new UnauthorizedAppException(
        'MFA verification is temporarily locked for this account after too many failed attempts. Try again later.',
      );
    }
    if (!admin.email) {
      throw new BadRequestAppException('Admin has no email on record.');
    }

    // Per-challenge cooldown so the "email me a code" button can't spam.
    const cooled = await this.redis.acquireLock(
      `admin:mfa:emailotp:cooldown:${claims.jti}`,
      EMAIL_OTP_COOLDOWN_SECONDS,
    );
    if (!cooled) {
      throw new BadRequestAppException(
        'A code was just sent. Please wait a moment before requesting another.',
      );
    }

    const otp = String(randomInt(100000, 1000000));
    const otpHash = createHash('sha256').update(otp).digest('hex');
    await this.redis.set(
      `admin:mfa:emailotp:${claims.jti}`,
      { otpHash, attempts: 0 },
      EMAIL_OTP_TTL_SECONDS,
    );

    const sent = await this.emailOtp.sendOtp(admin.email, otp).catch((err) => {
      this.logger.error(
        `Failed to send admin MFA email OTP: ${(err as Error)?.message}`,
      );
      return false;
    });
    if (!sent) {
      throw new BadRequestAppException(
        'Could not send the email code right now. Please try again shortly.',
      );
    }

    this.writeAudit(claims.sub, admin.role ?? null, 'ADMIN_MFA_EMAIL_OTP_SENT', {
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { otpExpiresIn: EMAIL_OTP_TTL_SECONDS };
  }

  /**
   * Step B — verify the emailed 6-digit code. Allows up to
   * EMAIL_OTP_MAX_ATTEMPTS tries against the same code (the challenge
   * jti is only consumed on success, so a mistype doesn't force a
   * re-login — unlike the TOTP path which is single-shot per challenge).
   */
  async verifyEmailOtp(input: {
    challengeToken: string;
    code: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AdminLoginSession> {
    const { code, ipAddress, userAgent } = input;
    const claims = this.verifyChallengeToken(input.challengeToken);
    if (!claims.jti) {
      throw new UnauthorizedAppException(
        'This MFA challenge is invalid; re-authenticate to obtain a fresh challenge.',
      );
    }
    const otpKey = `admin:mfa:emailotp:${claims.jti}`;
    const rec = await this.redis.get<{ otpHash: string; attempts: number }>(
      otpKey,
    );
    if (!rec) {
      throw new UnauthorizedAppException(
        'No email code was found or it has expired. Request a new code.',
      );
    }

    const admin = await this.adminRepo.findAdminById(claims.sub, {
      name: true,
      email: true,
      role: true,
      status: true,
      mfaEnabledAt: true,
      failedMfaAttempts: true,
      mfaLockUntil: true,
    });
    if (!admin) throw new UnauthorizedAppException('Admin not found');
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Admin account is not active');
    }
    if (!admin.mfaEnabledAt) {
      throw new BadRequestAppException(
        'Admin no longer has MFA enrolled; re-authenticate to obtain a fresh session.',
      );
    }
    const lockUntil = (admin as any).mfaLockUntil as Date | null | undefined;
    if (lockUntil && lockUntil.getTime() > Date.now()) {
      throw new UnauthorizedAppException(
        'MFA verification is temporarily locked for this account after too many failed attempts. Try again later.',
      );
    }

    const attempts = (rec.attempts ?? 0) + 1;
    if (attempts > EMAIL_OTP_MAX_ATTEMPTS) {
      await this.redis.del(otpKey);
      await this.bumpFailedAttempts(
        claims.sub,
        (admin as any).failedMfaAttempts as number | undefined,
        admin.role ?? null,
        'email_otp_max_attempts',
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedAppException(
        'Too many incorrect attempts. Request a new email code.',
      );
    }

    const candidate = createHash('sha256').update(code).digest('hex');
    const matches =
      candidate.length === rec.otpHash.length &&
      timingSafeEqual(Buffer.from(candidate), Buffer.from(rec.otpHash));
    if (!matches) {
      await this.redis.set(
        otpKey,
        { otpHash: rec.otpHash, attempts },
        EMAIL_OTP_TTL_SECONDS,
      );
      await this.bumpFailedAttempts(
        claims.sub,
        (admin as any).failedMfaAttempts as number | undefined,
        admin.role ?? null,
        'invalid_email_otp',
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedAppException(
        'Invalid email code. Check the code sent to your email and try again.',
      );
    }

    // Success — consume the challenge JTI (single-use, mirrors the TOTP
    // path) and delete the OTP so neither token can be replayed.
    const consumed = await this.redis.acquireLock(
      `admin:mfa:challenge:${claims.jti}`,
      15 * 60,
    );
    if (!consumed) {
      this.writeAudit(
        claims.sub,
        admin.role ?? null,
        'ADMIN_MFA_CHALLENGE_REPLAY',
        { jti: claims.jti, ipAddress, userAgent },
      );
      throw new UnauthorizedAppException(
        'This MFA challenge has already been used. Re-authenticate to obtain a fresh challenge.',
      );
    }
    await this.redis.del(otpKey);

    return this.mintSession(claims.sub, admin, ipAddress, userAgent, 'EMAIL');
  }

  /** Verify the short-lived challenge JWT (signature, audience, expiry). */
  private verifyChallengeToken(
    challengeToken: string,
  ): AdminMfaChallengeClaims {
    try {
      return jwt.verify(
        challengeToken,
        this.envService.getString('JWT_ADMIN_SECRET'),
        { algorithms: [JWT_ALGORITHM], audience: ADMIN_MFA_CHALLENGE_AUD },
      ) as AdminMfaChallengeClaims;
    } catch {
      throw new UnauthorizedAppException(
        'MFA challenge token is invalid or expired. Re-authenticate to obtain a new challenge.',
      );
    }
  }

  /**
   * Mint the admin session after a second factor passes. Mirrors the
   * tail of execute() (TOTP/backup path) so the email-OTP path issues
   * an identical session. Kept in lockstep with execute()'s success
   * block by intent.
   */
  private async mintSession(
    adminId: string,
    admin: {
      email?: string | null;
      name?: string | null;
      role?: string | null;
    },
    ipAddress: string | undefined,
    userAgent: string | undefined,
    method: 'EMAIL',
  ): Promise<AdminLoginSession> {
    await this.adminRepo.updateAdmin(adminId, {
      lastLoginAt: new Date(),
      failedMfaAttempts: 0,
      mfaLockUntil: null,
    });

    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(
      this.envService.getString('JWT_REFRESH_TTL', '30d'),
    );
    const session = await this.adminRepo.createAdminSession({
      adminId,
      refreshToken,
      userAgent: userAgent || null,
      ipAddress: ipAddress || null,
      expiresAt: new Date(Date.now() + refreshTtl),
    });

    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '15m');
    const accessTtlSeconds = Math.floor(this.parseTimeToMs(accessTtl) / 1000);
    const accessToken = jwt.sign(
      {
        sub: adminId,
        email: admin.email,
        role: admin.role,
        sessionId: session.id,
      },
      this.envService.getString('JWT_ADMIN_SECRET'),
      {
        expiresIn: accessTtlSeconds,
        algorithm: JWT_ALGORITHM,
        audience: JWT_AUDIENCE_ADMIN,
      },
    );

    this.accessLog
      .record({
        actorType: 'ADMIN',
        actorId: adminId,
        actorRole: admin.role ?? null,
        kind: 'LOGIN_SUCCESS',
        ipAddress,
        userAgent,
      })
      .catch(() => undefined);

    this.writeAudit(adminId, admin.role ?? null, 'ADMIN_MFA_SUCCESS', {
      method,
      sessionId: session.id,
      ipAddress,
      userAgent,
    });
    this.eventBus
      .publish({
        eventName: 'admin.mfa.login_succeeded',
        aggregate: 'admin',
        aggregateId: adminId,
        occurredAt: new Date(),
        payload: {
          adminId,
          email: admin.email ?? null,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          sessionId: session.id,
          method,
        },
      })
      .catch(() => undefined);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      admin: {
        adminId,
        name: admin.name ?? '',
        email: admin.email ?? '',
        role: admin.role ?? '',
      },
    };
  }

  /**
   * Phase 26 (2026-05-20) — Increment the per-admin MFA failure
   * counter, set the 15-min lock when threshold is hit, and emit
   * the audit row in one place so both failure paths (bad TOTP /
   * bad backup code) share the same accounting. Best-effort: a DB
   * write failure here must not swallow the underlying "wrong
   * code" 401 the caller is about to throw — that error is the
   * load-bearing signal to the user.
   */
  private async bumpFailedAttempts(
    adminId: string,
    currentCount: number | undefined,
    actorRole: string | null,
    reason: string,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): Promise<void> {
    const next = (currentCount ?? 0) + 1;
    const lock =
      next >= MFA_MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + MFA_LOCK_DURATION_MS)
        : null;
    try {
      await this.adminRepo.updateAdmin(adminId, {
        failedMfaAttempts: next,
        mfaLockUntil: lock,
      });
    } catch (err) {
      this.logger.error(
        `Failed to bump MFA failure counter for ${adminId}: ${(err as Error)?.message}`,
      );
    }
    this.writeAudit(adminId, actorRole, 'ADMIN_MFA_FAILED', {
      reason,
      failedMfaAttempts: next,
      locked: lock !== null,
      lockUntil: lock?.toISOString(),
      ipAddress,
      userAgent,
    });

    // Phase 207 (#3) — also write the failure to access_logs so the
    // brute-force spike detectors (which scan access_logs, NOT the
    // admin-mfa AuditLog table) can SEE an MFA-guessing attack. Without
    // this, an attacker who has the password and is hammering TOTP codes
    // is invisible to failedLoginSpike() / the BruteForceSpikeCron.
    // succeeded=false; metadata carries the failure reason (NOT the code).
    this.accessLog
      .record({
        actorType: 'ADMIN',
        actorId: adminId,
        actorRole: actorRole ?? undefined,
        kind: 'MFA_VERIFY_FAILED',
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        succeeded: false,
        reason,
        metadata: { failedMfaAttempts: next, locked: lock !== null },
      })
      .catch(() => undefined);
  }

  private writeAudit(
    adminId: string,
    actorRole: string | null,
    action: string,
    metadata: Record<string, unknown>,
  ): void {
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: actorRole ?? undefined,
        action,
        module: MFA_AUDIT_MODULE,
        resource: MFA_AUDIT_RESOURCE,
        resourceId: adminId,
        metadata,
        ipAddress:
          typeof metadata.ipAddress === 'string' ? metadata.ipAddress : undefined,
        userAgent:
          typeof metadata.userAgent === 'string' ? metadata.userAgent : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for ${action}: ${(err as Error)?.message}`,
        ),
      );
  }

  // Same parser as AdminLoginUseCase. The two TTL strings live in
  // the same env shape so reusing the logic keeps the parsing
  // semantics aligned.
  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }
}
