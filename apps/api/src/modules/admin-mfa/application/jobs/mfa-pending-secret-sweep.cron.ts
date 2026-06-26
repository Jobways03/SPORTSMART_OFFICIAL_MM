import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 25 (2026-05-20) — Stale MFA-pending-secret sweep.
 *
 * `AdminMfaService.beginEnrollment` writes the cleartext-equivalent
 * (AES-GCM-encrypted, but recoverable with the prod key) TOTP secret
 * to `mfaPendingSecretCiphertext` and stamps `mfaPendingExpiresAt`
 * 30 minutes in the future. If the admin never completes enrolment
 * (closed the tab, lost the QR, abandoned the flow), the pending
 * row sits there indefinitely without this sweep.
 *
 * The concern: an attacker who later compromises the admin's
 * authenticated session could call `/enroll/begin` to re-pull the
 * cleartext secret, OR a future bug in the begin path could leave a
 * partial-state pending row that obscures the admin's true MFA
 * status. Periodic cleanup keeps the column honest: if it's
 * populated, an enrolment is actively in progress.
 *
 * The sweep runs every 15 minutes (cadence matches the 30-min TTL
 * with safety margin) and only deletes rows past their declared
 * expiry — no policy guesswork, no chance of nuking a live
 * enrolment mid-flow.
 *
 * Cron is enabled by default; the gate exists so a local dev run
 * doesn't fire it spuriously.
 */
@Injectable()
export class MfaPendingSecretSweepCron {
  private readonly logger = new Logger(MfaPendingSecretSweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('MFA_PENDING_SWEEP_ENABLED', true);
  }

  // Every 15 minutes. The TTL is 30 min so we sweep ~twice per
  // possible expiry window — a long-tail abandoned row sits at
  // most 45 min before getting cleared.
  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('admin-mfa-pending-sweep', 5 * 60, async () => {
      await this.runOnce();
    });
  }

  async runOnce(): Promise<void> {
    try {
      // The schema column is in the migration but the generated
      // Prisma types lag a fresh `prisma generate`. Cast through any
      // so the sweep compiles without forcing a generate step in CI.
      const res = await this.prisma.admin.updateMany({
        where: {
          mfaPendingExpiresAt: { lt: new Date() },
          mfaPendingSecretCiphertext: { not: null },
        },
        data: {
          mfaPendingSecretCiphertext: null,
          mfaPendingExpiresAt: null,
        },
      });
      if (res.count > 0) {
        this.logger.log(
          `Cleared ${res.count} expired MFA pending-secret row(s).`,
        );
      }
    } catch (err) {
      this.logger.error(
        `MFA pending-secret sweep failed: ${(err as Error).message}`,
      );
    }
  }
}
