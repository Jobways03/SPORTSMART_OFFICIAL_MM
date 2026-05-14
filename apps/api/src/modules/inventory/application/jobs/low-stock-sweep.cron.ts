// Sprint 4 Story 3.4 — auto-detect low-stock conditions every 30 min.
//
// The manual `POST /admin/inventory/alerts/sweep` is the operator
// escape hatch. This cron is the steady-state detector — without it,
// alerts only appear after an admin remembers to click the button.
//
// Pattern matches release-expired-redemptions.cron.ts:
//   - Leader-elected (one pod runs the sweep, not every pod every tick).
//   - Instrumented (cron_runs_total + cron_run_duration_ms metrics).
//   - Feature-flagged (LOW_STOCK_SWEEP_CRON_ENABLED, default true).
//   - Never throws — silent failure logged + counted, doesn't kill cron.
//
// Failure mode if this cron is silent: alerts stop being created.
// Existing alerts still resolve correctly (resolved counter), and the
// manual sweep endpoint still works.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LowStockAlertService } from '../services/low-stock-alert.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';

@Injectable()
export class LowStockSweepCron {
  private readonly logger = new Logger(LowStockSweepCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly alerts: LowStockAlertService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  // Every 30 minutes — frequent enough to catch fast-moving SKUs, slow
  // enough that a sweep across all mappings stays cheap.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    // 35-minute lock — slightly longer than the tick interval so a
    // slow sweep on a previous tick can't be double-claimed.
    await this.leader.run('low-stock-sweep', 35 * 60, async () => {
      try {
        await this.instr.wrap('low-stock-sweep', async () => {
          const { created, resolved } = await this.alerts.sweep();
          return { created, resolved };
        });
      } catch (err) {
        this.logger.error('Low-stock sweep failed', err as Error);
      }
    });
  }

  private enabled(): boolean {
    return this.env.getBoolean('LOW_STOCK_SWEEP_CRON_ENABLED', true);
  }
}
