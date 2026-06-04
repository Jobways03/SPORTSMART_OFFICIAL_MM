// Phase 163 (Tax Audit Readiness Dashboard audit #16) — readiness
// snapshot cron.
//
// Every 6 hours, builds the platform-wide audit-readiness report and
// persists a point-in-time snapshot to tax_readiness_snapshots. This
// backs:
//   - the trend view ("is readiness improving week-over-week?"), and
//   - a forensic question ("how many blockers existed on date X?").
//
// Cluster-safe via LeaderElectedCron; instrumented via
// CronInstrumentationService. The platform-wide build (no filter) is
// what the dashboard shows, so the snapshot matches what an operator saw.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { TaxAuditReadinessService } from '../services/tax-audit-readiness.service';

@Injectable()
export class TaxReadinessSnapshotCron {
  private readonly logger = new Logger(TaxReadinessSnapshotCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly readiness: TaxAuditReadinessService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('TAX_READINESS_SNAPSHOT_CRON_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('tax-readiness-snapshot', 10 * 60, async () => {
      try {
        await this.instr.wrap('tax-readiness-snapshot', () => this.runOnce());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  async runOnce(): Promise<{ totalBlockers: number; criticalBlockers: number; ready: boolean }> {
    const report = await this.readiness.build();
    await this.readiness.persistSnapshot(report);
    this.logger.log(
      `Readiness snapshot: mode=${report.currentMode} ready=${report.ready} ` +
        `total=${report.totalBlockers} critical=${report.criticalBlockers}`,
    );
    return {
      totalBlockers: report.totalBlockers,
      criticalBlockers: report.criticalBlockers,
      ready: report.ready,
    };
  }
}
