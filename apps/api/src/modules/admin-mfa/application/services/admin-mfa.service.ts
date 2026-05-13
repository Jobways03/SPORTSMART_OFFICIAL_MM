import { Inject, Injectable } from '@nestjs/common';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
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

/**
 * Phase 10 (PR 10.4) — Admin MFA enrollment orchestration.
 *
 * Composes the building blocks from PR 10.1–10.3:
 *
 *   1. `beginEnrollment(adminId)` — generates a fresh TOTP secret,
 *      encrypts it into `mfaPendingSecretCiphertext` (so a botched
 *      enrollment can't lock the admin out of their existing live
 *      secret if one exists), and returns the otpauth:// URI ready
 *      for QR-code rendering. The cleartext secret is included in
 *      the response too so the frontend can show a manual-entry
 *      fallback (the URI itself contains the secret in base32).
 *
 *   2. `completeEnrollment(adminId, code)` — decrypts the pending
 *      secret, verifies the code, atomically moves pending →
 *      live + sets `mfaEnabledAt`. Anti-replay tracking against
 *      the matched step lands in PR 10.6's login-time challenge;
 *      enrollment-time replay is much less interesting because the
 *      code is single-use by construction (the pending column
 *      clears once the code is consumed).
 *
 * Refusal semantics:
 *   - beginEnrollment on an already-enrolled admin → 409 Conflict.
 *     Re-enrolling requires explicitly disabling first; otherwise
 *     an attacker who's compromised the first factor could silently
 *     swap MFA to their own device.
 *   - completeEnrollment with no pending → 400 (must beginEnrollment
 *     first). completeEnrollment on an already-enrolled admin →
 *     409. Wrong code → 400.
 *
 * The service is pure-logic — no controller, no HTTP. PR 10.5 wires
 * it into a controller with the admin auth guard.
 */
@Injectable()
export class AdminMfaService {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly cipher: MfaSecretCipher,
    private readonly env: EnvService,
    private readonly backupCodes: BackupCodesService,
  ) {}

  async beginEnrollment(
    adminId: string,
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

    // Overwriting any previous `mfaPendingSecretCiphertext` is fine —
    // restarting enrollment discards the previous attempt (the user
    // explicitly chose to start over).
    await this.adminRepo.updateAdmin(adminId, {
      mfaPendingSecretCiphertext: ciphertext,
    });

    return { otpAuthUrl, secret };
  }

  async completeEnrollment(
    adminId: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      mfaPendingSecretCiphertext: true,
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

    // Decrypt — throws BadRequestAppException on key mismatch or
    // tampered ciphertext (handled at the controller layer as 400).
    const pendingSecret = this.cipher.decrypt(admin.mfaPendingSecretCiphertext);
    const result = verifyTotpCode({ secret: pendingSecret, code });
    if (!result.valid) {
      throw new BadRequestAppException(
        'Invalid TOTP code. Check your authenticator app and try again.',
      );
    }

    // Commit: pending → live, set enrolled-at, seed the anti-replay
    // baseline. Four columns updated in one call so a partial write
    // can't leave the admin half-enrolled.
    await this.adminRepo.updateAdmin(adminId, {
      mfaSecretCiphertext: admin.mfaPendingSecretCiphertext,
      mfaPendingSecretCiphertext: null,
      mfaEnabledAt: new Date(),
      mfaLastUsedStep: result.step,
    });

    // PR 10.9 — generate + persist backup codes AFTER the live secret
    // is committed. The cleartext codes are returned ONCE to the
    // caller (the controller surfaces them to the admin with a
    // "save these now" warning). Generating after the commit means
    // a hypothetical bcrypt-hashing failure leaves the admin
    // enrolled-but-codeless rather than blocking the enrollment
    // entirely — the admin can request a re-generation later.
    const backupCodes = await this.backupCodes.generateAndHashForAdmin(adminId);
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
   *
   * Same code-format dispatch as the login-challenge verifier:
   * 6-digit TOTP path runs the standard verify + anti-replay; the
   * XXXXX-XXXXX backup-code path bcrypt-matches and consumes.
   */
  async stepUp(
    adminId: string,
    sessionId: string,
    code: string,
  ): Promise<void> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      mfaEnabledAt: true,
      mfaSecretCiphertext: true,
      mfaLastUsedStep: true,
    });
    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }
    if (!admin.mfaEnabledAt || !admin.mfaSecretCiphertext) {
      throw new BadRequestAppException(
        'Step-up requires MFA enrollment. Enroll first via /admin/mfa/enroll/begin.',
      );
    }

    let stepToCommit: number | undefined;
    if (isBackupCodeFormat(code)) {
      const consumed = await this.backupCodes.consume(adminId, code);
      if (!consumed) {
        throw new BadRequestAppException(
          'Invalid backup code. Use the codes from your enrollment-time download.',
        );
      }
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

    // Stamp the session as freshly step-up-verified, and advance
    // the anti-replay baseline on TOTP success. Backup-code use
    // doesn't write mfaLastUsedStep (it has no step concept; the
    // consume-and-splice is the anti-replay mechanism there).
    if (!this.adminRepo.markSessionStepUpVerified) {
      throw new BadRequestAppException(
        'Step-up persistence is unavailable on this repository binding',
      );
    }
    await this.adminRepo.markSessionStepUpVerified(sessionId);
    if (stepToCommit !== undefined) {
      await this.adminRepo.updateAdmin(adminId, {
        mfaLastUsedStep: stepToCommit,
      });
    }
  }
}
