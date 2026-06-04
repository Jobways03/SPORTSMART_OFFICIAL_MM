import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 203 (#15) — audit-log retention sweeper (env-gated SKELETON).
 *
 * HONEST-CALL: the audit log is a LEGAL, tamper-evident record. Indian
 * compliance regimes that apply here (CERT-In 6-month-minimum logging, DPDP,
 * and financial-record retention under the Companies Act / GST) push the
 * effective floor to roughly 5–7 YEARS, not the 180 days the access-log
 * retention uses. Deleting a hash-chained row also FORKS the chain at that
 * point unless the genesis/anchor bookkeeping is re-based — so this sweeper is:
 *
 *   • OFF by default (AUDIT_LOG_RETENTION_ENABLED=false);
 *   • defaulted to ~7 years (AUDIT_LOG_RETENTION_DAYS=2557) when on;
 *   • a hard no-op unless EXPLICITLY enabled, with a loud warning.
 *
 * SURFACED for the central reconcile (NOT built here): (1) a cold-archive
 * export of the to-be-deleted rows to immutable object storage BEFORE delete,
 * and (2) re-anchoring the chain so a post-pruning verify still passes from a
 * fresh genesis. Until those exist, enabling this in production would damage
 * the tamper-evidence guarantee — hence the conservative gate.
 */
@Injectable()
export class AuditLogRetentionCron {
  private readonly logger = new Logger(AuditLogRetentionCron.name);

  private readonly BATCH_SIZE = 5_000;
  private readonly MAX_BATCHES_PER_RUN = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('AUDIT_LOG_RETENTION_ENABLED', false);
  }

  retentionDays(): number {
    const d = this.env.getNumber('AUDIT_LOG_RETENTION_DAYS', 2557);
    return Number.isFinite(d) && d >= 365 ? Math.floor(d) : 2557;
  }

  // Daily at 04:45 — after the access-log sweep (04:15), clear of settlement.
  @Cron('45 4 * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    this.logger.warn(
      'AUDIT_LOG_RETENTION_ENABLED is ON — pruning the tamper-evident audit log. ' +
        'Ensure cold-archive export + chain re-anchoring are in place (SURFACED).',
    );
    await this.leader.run('audit-log-retention', 30 * 60, async () => {
      await this.runOnce();
    });
  }

  async runOnce(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays() * 24 * 60 * 60 * 1000);
    let total = 0;
    try {
      for (let i = 0; i < this.MAX_BATCHES_PER_RUN; i++) {
        const batch = await this.prisma.auditLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { sequenceNumber: 'asc' },
          take: this.BATCH_SIZE,
        });
        if (batch.length === 0) break;
        const res = await this.prisma.auditLog.deleteMany({
          where: { id: { in: batch.map((r) => r.id) } },
        });
        total += res.count;
        if (batch.length < this.BATCH_SIZE) break;
      }
    } catch (err) {
      this.logger.error(`Audit-log retention sweep failed after ${total}: ${(err as Error).message}`);
      return total;
    }
    if (total > 0) {
      this.logger.warn(
        `Deleted ${total} audit_log row(s) older than ${this.retentionDays()}d (cutoff ${cutoff.toISOString()})`,
      );
    }
    return total;
  }
}
