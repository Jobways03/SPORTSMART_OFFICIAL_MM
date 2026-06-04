import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 201 (#8) — access-log retention sweeper.
 *
 * The access_logs table grows without bound: a TOKEN_REFRESH row is
 * written on every silent token refresh (every ~15 minutes per live
 * session), plus a row per login / logout / password-reset. At any
 * realistic user count this is the fastest-growing table in the
 * schema and nothing ever prunes it.
 *
 * Past the retention window the rows have no value:
 *   • the customer access-history surface shows the last N events;
 *   • the admin forensic surface investigates recent activity;
 *   • the unified hash-chained AuditLog retains security-relevant
 *     events for compliance independently.
 *
 * The sweep:
 *   • Hard-deletes access_logs where createdAt < now - RETENTION_DAYS
 *     (default 180), in capped batches so a large first run doesn't
 *     hold a long delete lock.
 *   • Runs once a day at 04:15 (after the revoked-session sweep at
 *     04:00; clear of the 03:00 settlement window).
 *   • Leader-elected so a multi-replica deployment runs it once, not
 *     once-per-replica.
 *
 * Env: ACCESS_LOG_RETENTION_ENABLED (default true),
 *      ACCESS_LOG_RETENTION_DAYS (default 180). Delete-only on
 *      audit rows — no money-correctness risk — so default-on is safe;
 *      the flag exists for local-dev convenience and for compliance to
 *      widen the window without a code change.
 */
@Injectable()
export class AccessLogRetentionCron {
  private readonly logger = new Logger(AccessLogRetentionCron.name);

  // Cap per delete so the first run on a backlog doesn't take a
  // table-wide lock. Loop until a batch comes back short.
  private readonly BATCH_SIZE = 10_000;
  // Bound total per tick so a pathological backlog can't run for hours;
  // the next day's tick continues where this one stopped.
  private readonly MAX_BATCHES_PER_RUN = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('ACCESS_LOG_RETENTION_ENABLED', true);
  }

  retentionDays(): number {
    const d = this.env.getNumber('ACCESS_LOG_RETENTION_DAYS', 180);
    return Number.isFinite(d) && d >= 1 ? Math.floor(d) : 180;
  }

  // Daily at 04:15. 30-minute lock window covers a slow batched sweep
  // without overlapping the next firing.
  @Cron('15 4 * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('access-log-retention', 30 * 60, async () => {
      await this.runOnce();
    });
  }

  async runOnce(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.retentionDays() * 24 * 60 * 60 * 1000,
    );

    let total = 0;
    try {
      for (let i = 0; i < this.MAX_BATCHES_PER_RUN; i++) {
        // deleteMany has no LIMIT in Prisma, so select a batch of ids
        // then delete by id. Keeps each statement bounded.
        const batch = await this.prisma.accessLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: this.BATCH_SIZE,
        });
        if (batch.length === 0) break;

        const res = await this.prisma.accessLog.deleteMany({
          where: { id: { in: batch.map((r) => r.id) } },
        });
        total += res.count;

        if (batch.length < this.BATCH_SIZE) break;
      }
    } catch (err) {
      this.logger.error(
        `Access-log retention sweep failed after ${total} deletions: ${(err as Error).message}`,
      );
      return total;
    }

    if (total > 0) {
      this.logger.log(
        `Deleted ${total} access_log row(s) older than ${this.retentionDays()}d (cutoff ${cutoff.toISOString()})`,
      );
    }
    return total;
  }
}
