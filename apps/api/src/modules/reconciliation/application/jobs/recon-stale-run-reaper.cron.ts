import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { ReconciliationService } from '../services/reconciliation.service';

/**
 * Phase 173 (Recon audit #1) — stale-run reaper.
 *
 * Runs execute in-process (detached) after the POST returns. If the node
 * crashes mid-scan the row is left QUEUED/RUNNING forever, which ALSO holds the
 * (kind, period) concurrency lock (#2) so the same recon can never be launched
 * again. This leader-elected cron flips runs that have been live past the
 * staleness window to FAILED, freeing the lock.
 */
@Injectable()
export class ReconStaleRunReaperCron {
  private readonly logger = new Logger(ReconStaleRunReaperCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async run(): Promise<void> {
    if (!this.env.getBoolean('RECON_STALE_RUN_REAPER_ENABLED', true)) {
      return;
    }
    await this.leader.run('recon-stale-run-reaper', 600, async () => {
      const staleMinutes = this.env.getNumber(
        'RECON_STALE_RUN_MINUTES',
        60,
      );
      await this.reconciliation.reapStaleRuns(staleMinutes);
    });
  }
}
