import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 27 (2026-05-21) — old-revoked-session sweeper.
 *
 * Sessions are soft-deleted (revokedAt + revokedBy + revocationReason)
 * so the admin audit trail can replay "who was logged in when X
 * happened, who killed it, why." After 90 days the row's forensic
 * value is moot: the unified AuditLog (hash-chained + tamper-evident)
 * retains the revoke event for compliance, and the session row itself
 * is just disk + index bloat.
 *
 * The sweep:
 *   • Hard-deletes rows where revokedAt < now - 90d, across all 5
 *     actor session tables. Active sessions (revokedAt = null) are
 *     untouched.
 *   • Runs once a day at 04:00 (after the RBAC sweep at 03:30 and
 *     settlements at 03:00; clear of the busy windows).
 *   • Leader-elected so a multi-instance deployment doesn't run it
 *     5×; the cron-heartbeat detector flags silent crashes.
 *
 * Env flag SESSION_REVOKED_SWEEP_ENABLED defaults true. Read-only
 * effect on active state (only revokedAt-bearing rows are touched)
 * so there's no money-correctness risk; the flag exists for local
 * dev convenience only.
 */
@Injectable()
export class OldRevokedSessionsSweepCron {
  private readonly logger = new Logger(OldRevokedSessionsSweepCron.name);
  // Keep 90 days of revoked rows so an investigator can trace a
  // recent compromise back through a quarter. Tunable via env if
  // compliance later mandates a different window.
  private readonly RETENTION_DAYS = 90;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('SESSION_REVOKED_SWEEP_ENABLED', true);
  }

  // Daily at 04:00. Run-once-per-day cadence with a 30-minute lock
  // window covers a slow sweep without overlapping the next firing.
  @Cron('0 4 * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('old-revoked-sessions-sweep', 30 * 60, async () => {
      await this.runOnce();
    });
  }

  async runOnce(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    // Run the 5 deletes sequentially. Concurrent deletes on different
    // tables would be fine but logging is easier line-by-line, and
    // total work is small (revoked rows accumulate slowly).
    const totals: Record<string, number> = {};
    try {
      const admin = await this.prisma.adminSession.deleteMany({
        where: { revokedAt: { not: null, lt: cutoff } },
      });
      totals.admin = admin.count;

      const user = await this.prisma.session.deleteMany({
        where: { revokedAt: { not: null, lt: cutoff } },
      });
      totals.user = user.count;

      const seller = await this.prisma.sellerSession.deleteMany({
        where: { revokedAt: { not: null, lt: cutoff } },
      });
      totals.seller = seller.count;

      const franchise = await this.prisma.franchiseSession.deleteMany({
        where: { revokedAt: { not: null, lt: cutoff } },
      });
      totals.franchise = franchise.count;

      const affiliate = await this.prisma.affiliateSession.deleteMany({
        where: { revokedAt: { not: null, lt: cutoff } },
      });
      totals.affiliate = affiliate.count;
    } catch (err) {
      this.logger.error(
        `Old-revoked-sessions sweep failed: ${(err as Error).message}`,
      );
      return;
    }

    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      this.logger.log(
        `Deleted ${sum} revoked session(s) older than ${this.RETENTION_DAYS}d: ${JSON.stringify(totals)}`,
      );
    }
  }
}
