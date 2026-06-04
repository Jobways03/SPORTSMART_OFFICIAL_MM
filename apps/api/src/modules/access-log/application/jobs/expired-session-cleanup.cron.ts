import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 209 (#17) — expired-session cleanup sweeper.
 *
 * The Phase-27 OldRevokedSessionsSweepCron only prunes rows that were
 * explicitly REVOKED (revokedAt < now - 90d). A session that simply
 * TIMED OUT — its refresh token reached expiresAt and the user never
 * came back, never logged out, never got revoked — stays in the table
 * forever. Over time the active-session list, the per-request guard
 * lookups, and the indexes all carry an ever-growing tail of dead-but-
 * unrevoked rows.
 *
 * Auth correctness does NOT depend on this sweep: every auth guard
 * already rejects a session whose expiresAt is in the past, so a live
 * expired row is inert. This is purely disk + index hygiene.
 *
 * The sweep:
 *   • Hard-deletes rows where expiresAt < now - GRACE_DAYS (default 30)
 *     AND revokedAt IS NULL, across all 5 actor session tables. The
 *     grace window keeps recently-expired rows briefly so an operator
 *     investigating a just-now incident can still see the last session.
 *     (Revoked rows are intentionally left to the revoked-sweep's 90d
 *     window so the "who killed it / why" forensics survive longer.)
 *   • Runs daily at 04:30 (after revoked-sweep 04:00 + retention 04:15).
 *   • Leader-elected so a multi-replica deploy runs it once.
 *
 * Env: SESSION_EXPIRED_CLEANUP_ENABLED (default true),
 *      SESSION_EXPIRED_CLEANUP_GRACE_DAYS (default 30).
 */
@Injectable()
export class ExpiredSessionCleanupCron {
  private readonly logger = new Logger(ExpiredSessionCleanupCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('SESSION_EXPIRED_CLEANUP_ENABLED', true);
  }

  graceDays(): number {
    const d = this.env.getNumber('SESSION_EXPIRED_CLEANUP_GRACE_DAYS', 30);
    return Number.isFinite(d) && d >= 0 ? Math.floor(d) : 30;
  }

  // Daily at 04:30. 30-min lock window covers a slow sweep without
  // overlapping the next firing.
  @Cron('30 4 * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('expired-session-cleanup', 30 * 60, async () => {
      await this.runOnce();
    });
  }

  async runOnce(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.graceDays() * 24 * 60 * 60 * 1000,
    );
    // Only purge rows that timed out AND were never explicitly revoked —
    // revoked rows belong to the (longer-retention) revoked sweep.
    const where = { revokedAt: null, expiresAt: { lt: cutoff } } as const;

    const totals: Record<string, number> = {};
    try {
      totals.admin = (await this.prisma.adminSession.deleteMany({ where })).count;
      totals.user = (await this.prisma.session.deleteMany({ where })).count;
      totals.seller = (await this.prisma.sellerSession.deleteMany({ where })).count;
      totals.franchise = (
        await this.prisma.franchiseSession.deleteMany({ where })
      ).count;
      totals.affiliate = (
        await this.prisma.affiliateSession.deleteMany({ where })
      ).count;
    } catch (err) {
      this.logger.error(
        `Expired-session cleanup failed: ${(err as Error).message}`,
      );
      return;
    }

    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      this.logger.log(
        `Deleted ${sum} expired (unrevoked) session(s) older than ${this.graceDays()}d: ${JSON.stringify(totals)}`,
      );
    }
  }
}
