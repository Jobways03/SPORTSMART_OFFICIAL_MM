// Sprint 4 Story 3.4 — auto-detect low-stock conditions.
//
// Phase 54 (2026-05-21) — tick interval tightened from 30 min to
// 15 min (audit Gap #2). Combined with the new event-driven trigger
// path (LowStockAlertEventSubscriber) the worst-case detection lag
// drops from 30 min to ≤15 min on the cron tail, and near-zero on
// the event path.
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
// Failure mode if this cron is silent: alerts stop being created
// from the periodic scan. The event-driven path still fires on every
// stock change, so the cron is now the backstop rather than the
// primary detector.

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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

  // Phase 54 — every 15 minutes (00/15/30/45 of each hour).
  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    // Phase 54 — 20-minute lock; slightly longer than the new 15-min
    // tick so a slow sweep can't be double-claimed by the next tick.
    await this.leader.run('low-stock-sweep', 20 * 60, async () => {
      try {
        await this.instr.wrap('low-stock-sweep', async () => {
          const { created, resolved, scanned } = await this.alerts.sweep();
          return { created, resolved, scanned };
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
