import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { IThinkConfig } from '../../../../integrations/ithink/config/ithink.config';
import { IThinkTrackingService } from '../../../../integrations/ithink/services/ithink-tracking.service';
import { IngestTrackingUpdateUseCase } from '../../application/use-cases/ingest-tracking-update.use-case';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import {
  POLLER_CHECKPOINT_REPOSITORY,
  PollerCheckpointRepository,
} from '../../../../bootstrap/scheduler/poller-checkpoint.repository';

/**
 * Tracking firehose poller.
 *
 * iThink has no webhook mechanism; status updates surface via the
 * Get Airwaybill endpoint as a "AWBs whose status changed in the
 * last N minutes" query. We poll every 25 minutes by default, ask
 * for a window that resumes from the last persisted cursor, then
 * feed the returned AWBs into the IngestTrackingUpdateUseCase which
 * calls Track Order for each one to fetch its full scan history and
 * updates the SubOrder row.
 *
 * The window-start is computed from `IntegrationPollerCheckpoint`
 * (PR 1.11). Three cases:
 *
 *   - No checkpoint yet (fresh deploy, or first run after a manual
 *     purge): use `now − (intervalMinutes + 2)` so the first poll
 *     covers a full window plus a small overlap.
 *
 *   - Checkpoint within iThink's 30-min hard window cap: resume
 *     from `checkpoint − 2-min overlap` to absorb cron drift.
 *
 *   - Checkpoint older than iThink's cap (e.g. process was down for
 *     2 hours): clamp the window-start to `now − 29 min` so the API
 *     accepts it. Events older than 29 min are unreachable via this
 *     endpoint by iThink's design — they'll appear when the
 *     individual Track Order calls fire as part of regular per-AWB
 *     ingestion later.
 *
 * Disabled by default in dev (ITHINK_TRACKING_POLL_ENABLED=false).
 * Flip to true in staging/prod once warehouses are registered and
 * we're actually booking shipments.
 */
@Injectable()
export class IThinkTrackingPollerCron {
  private readonly logger = new Logger(IThinkTrackingPollerCron.name);

  /** Stable key into IntegrationPollerCheckpoint. Don't change. */
  private static readonly POLLER_KEY = 'ithink-tracking';

  /**
   * iThink's API hard-caps the window at 30 min. Use 29 min for the
   * clamp so the request never lands on the boundary and gets
   * rejected by their server-side validation.
   */
  private static readonly ITHINK_WINDOW_HARD_CAP_MINUTES = 29;

  /**
   * Overlap (in minutes) baked into the window start to absorb cron
   * drift. A tick that fires 60 seconds late shouldn't drop an event
   * that arrived in the overlap window.
   */
  private static readonly OVERLAP_MINUTES = 2;

  constructor(
    private readonly config: IThinkConfig,
    private readonly tracking: IThinkTrackingService,
    private readonly ingest: IngestTrackingUpdateUseCase,
    // Phase 1 (PR 1.2) — without leader-election, N replicas would
    // hit iThink's tracking firehose N times per window, each
    // ingesting the same AWBs.
    private readonly leader: LeaderElectedCron,
    // Phase 1 (PR 1.11) — persistent cursor. Replaces the previous
    // in-memory `lastPolledAt` field, which was lost on restart and
    // distinct per replica (leader bounce → fresh poll, duplicate
    // API calls).
    @Inject(POLLER_CHECKPOINT_REPOSITORY)
    private readonly checkpoints: PollerCheckpointRepository,
    // Phase 5 (PR 5.1) — cron-run observability. Wraps each poll
    // body in `instr.wrap(jobName, ...)` so the run lands a row in
    // `cron_runs` (started_at, finished_at, durationMs, status,
    // result-shaped metrics). The heartbeat detector uses the same
    // table to alert on silently-stopped pollers.
    private readonly instr: CronInstrumentationService,
  ) {}

  /**
   * Fires every 10 minutes — but only runs the actual poll if the
   * configured interval has elapsed since the last successful run.
   * Two-stage gating keeps cron decoration simple while still
   * supporting per-env tuning via ITHINK_TRACKING_POLL_INTERVAL_MINUTES.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    if (!this.config.trackingPollEnabled) return;
    if (!this.config.isConfigured) {
      this.logger.warn('iThink not configured; tracking poller skipped');
      return;
    }

    await this.leader.run('ithink-tracking-poller', 20 * 60, async () => {
      // Phase 5 (PR 5.1) — wrap the body so each successful + failed
      // poll lands a SQL-queryable row in `cron_runs`. The metric
      // shape `{ skipped, awbs, updated, orphan }` is the same JSON
      // the heartbeat dashboard charts.
      //
      // pollOnce re-throws on iThink-side failure so the instr.wrap
      // call records status=FAILED. We swallow at this boundary so
      // the cron tick itself completes normally (heartbeat lives in
      // cron_runs now; double-logging from @nestjs/schedule's
      // default error handler isn't worth the noise).
      try {
        await this.instr.wrap('ithink-tracking-poller', () => this.pollOnce());
      } catch (err) {
        // Already recorded as FAILED in cron_runs above; nothing to do.
      }
    });
  }

  private async pollOnce(): Promise<{
    skipped: boolean;
    awbs: number;
    updated: number;
    orphan: number;
  }> {
    const now = new Date();
    const lastPolledAt = await this.checkpoints.get(
      IThinkTrackingPollerCron.POLLER_KEY,
    );

    // Throttle: skip this tick if the configured interval hasn't
    // elapsed since the last successful poll. The DB-backed check
    // means leader bounce (replica A → replica B) doesn't re-poll
    // a window that A already covered.
    if (lastPolledAt) {
      const minutesElapsed = (now.getTime() - lastPolledAt.getTime()) / 60_000;
      if (minutesElapsed < this.config.trackingPollIntervalMinutes) {
        return { skipped: true, awbs: 0, updated: 0, orphan: 0 };
      }
    }

    const start = this.computeWindowStart(now, lastPolledAt);

    try {
      const awbs = await this.tracking.getAirwaybillsChanged({
        startDateTime: start,
        endDateTime: now,
      });
      let updated = 0;
      let missing = 0;
      if (awbs.length === 0) {
        const windowMin = Math.round((now.getTime() - start.getTime()) / 60_000);
        this.logger.debug(`iThink poll: no AWB changes in last ${windowMin}m`);
      } else {
        const ingested = await this.ingest.ingestForIThink(awbs);
        updated = ingested.updated;
        missing = ingested.missing;
        this.logger.log(
          `iThink poll: ${awbs.length} changed, ${updated} updated, ${missing} orphan`,
        );
      }
      // Persist only on success. A failed poll leaves the cursor
      // untouched so the next tick retries the same window.
      await this.checkpoints.set(IThinkTrackingPollerCron.POLLER_KEY, now);
      return { skipped: false, awbs: awbs.length, updated, orphan: missing };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`iThink poll failed: ${message}`);
      // Re-throw so the cron-instrumentation wrapper logs it as
      // FAILED and the heartbeat detector can alert. The leader
      // lock is still released via LeaderElectedCron's finally.
      throw error;
    }
  }

  /**
   * Window start = max(checkpoint − overlap, now − hardCap).
   *
   * - No checkpoint: fall back to the configured interval plus the
   *   overlap (so first-ever run sees a full window).
   * - Checkpoint present but inside iThink's hard cap: resume from
   *   `checkpoint − overlap`.
   * - Checkpoint older than the hard cap: clamp at `now − hardCap`
   *   so the request is accepted by iThink's server-side validation.
   */
  private computeWindowStart(now: Date, lastPolledAt: Date | null): Date {
    if (!lastPolledAt) {
      const windowMinutes = this.config.trackingPollIntervalMinutes;
      return new Date(
        now.getTime() -
          (windowMinutes + IThinkTrackingPollerCron.OVERLAP_MINUTES) * 60_000,
      );
    }
    const resumeFromMs =
      lastPolledAt.getTime() -
      IThinkTrackingPollerCron.OVERLAP_MINUTES * 60_000;
    const hardCapMs =
      now.getTime() -
      IThinkTrackingPollerCron.ITHINK_WINDOW_HARD_CAP_MINUTES * 60_000;
    return new Date(Math.max(resumeFromMs, hardCapMs));
  }
}
