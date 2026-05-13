import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { JWT_ALGORITHM } from '../../../../core/auth/jwt-constants';
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

interface AdminMfaVerifyChallengeInput {
  challengeToken: string;
  code: string;
  userAgent?: string;
  ipAddress?: string;
}

interface AdminMfaChallengeClaims {
  sub: string;
  email: string;
  aud: string;
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
 * Anti-replay deferred to PR 10.7: a TOTP code reused within its
 * 30s window is currently accepted. The follow-up adds a
 * `mfaLastUsedStep` column on the Admin model and rejects codes
 * for `step <= mfaLastUsedStep`. The narrow window + the requirement
 * that an attacker already has a valid challenge token bounds the
 * exposure tightly for now, but it's a real gap, called out
 * explicitly here so a future PR closes it.
 */
@Injectable()
export class AdminMfaVerifyChallengeUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly envService: EnvService,
    private readonly cipher: MfaSecretCipher,
    private readonly backupCodes: BackupCodesService,
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

    // 2. Fetch admin's encrypted secret + enrollment timestamp.
    const admin = await this.adminRepo.findAdminById(claims.sub, {
      name: true,
      email: true,
      role: true,
      status: true,
      mfaSecretCiphertext: true,
      mfaEnabledAt: true,
      mfaLastUsedStep: true,
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

    // 3. Verify code. Dispatch on format: backup codes look like
    //    XXXXX-XXXXX (alphanumeric); TOTP codes are 6 digits.
    //    The split keeps the TOTP-vs-backup-code paths cleanly
    //    separated — backup codes don't have a "step" concept and
    //    don't participate in the mfaLastUsedStep anti-replay
    //    (they're single-use by construction: the matching hash
    //    is removed from the persisted list on consume).
    let stepToCommit: number | undefined;
    if (isBackupCodeFormat(code)) {
      // PR 10.9 — backup-code recovery path. Used when the admin
      // has lost their authenticator device. BackupCodesService
      // bcrypt-matches against the stored hash list and removes
      // the consumed entry on success.
      const consumed = await this.backupCodes.consume(claims.sub, code);
      if (!consumed) {
        throw new UnauthorizedAppException(
          'Invalid backup code. If you have run out of backup codes, contact an admin with full account rights for manual recovery.',
        );
      }
      // stepToCommit stays undefined — backup-code use doesn't
      // advance mfaLastUsedStep (no step to record).
    } else {
      const secret = this.cipher.decrypt(admin.mfaSecretCiphertext);
      const verify = verifyTotpCode({ secret, code });
      if (!verify.valid) {
        throw new UnauthorizedAppException(
          'Invalid TOTP code. Check your authenticator app and try again.',
        );
      }

      // PR 10.7 — anti-replay. The TOTP step counter is monotonic
      // (unix_seconds / period). Rejecting codes for step <=
      // mfaLastUsedStep closes the replay window: an attacker who
      // captured a single in-flight TOTP code (shoulder-surf,
      // leaked screenshot) can no longer present it again within
      // the 30s validity AND the ±1-step skew tolerance.
      //
      // <= rather than <: a code at the same step is a literal
      // replay of the same code. Strict-less-than would let the
      // same TOTP value re-authenticate up to N times within its
      // validity window (where N is bounded only by network RTT).
      if (
        verify.step !== undefined &&
        admin.mfaLastUsedStep !== null &&
        admin.mfaLastUsedStep !== undefined &&
        verify.step <= admin.mfaLastUsedStep
      ) {
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
    const updateData: Record<string, unknown> = {
      lastLoginAt: new Date(),
    };
    if (stepToCommit !== undefined) {
      updateData.mfaLastUsedStep = stepToCommit;
    }
    await this.adminRepo.updateAdmin(claims.sub, updateData);

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

    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '7d');
    const accessTtlSeconds = Math.floor(this.parseTimeToMs(accessTtl) / 1000);
    const accessToken = jwt.sign(
      {
        sub: claims.sub,
        email: admin.email,
        role: admin.role,
        sessionId: session.id,
      },
      this.envService.getString('JWT_ADMIN_SECRET'),
      { expiresIn: accessTtlSeconds, algorithm: JWT_ALGORITHM },
    );

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

  // Same parser as AdminLoginUseCase. The two TTL strings live in
  // the same env shape so reusing the logic keeps the parsing
  // semantics aligned.
  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }
}
