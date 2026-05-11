import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { IThinkConfig } from '../../../../integrations/ithink/config/ithink.config';
import { IThinkTrackingService } from '../../../../integrations/ithink/services/ithink-tracking.service';
import { IngestTrackingUpdateUseCase } from '../../application/use-cases/ingest-tracking-update.use-case';

/**
 * Tracking firehose poller.
 *
 * iThink has no webhook mechanism; status updates surface via the
 * Get Airwaybill endpoint as a "AWBs whose status changed in the
 * last N minutes" query. We poll every 25 minutes by default, ask
 * for a 25-min window, then feed the returned AWBs into the
 * IngestTrackingUpdateUseCase which calls Track Order for each one
 * to fetch its full scan history and updates the SubOrder row.
 *
 * The window length and slack are tuned to:
 *   * Stay inside iThink's hard 30-min window cap.
 *   * Tolerate cron drift / restarts — overlap of 1-5 min means a
 *     dropped tick still ingests the missed window on the next run.
 *
 * Disabled by default in dev (ITHINK_TRACKING_POLL_ENABLED=false).
 * Flip to true in staging/prod once warehouses are registered and
 * we're actually booking shipments.
 */
@Injectable()
export class IThinkTrackingPollerCron {
  private readonly logger = new Logger(IThinkTrackingPollerCron.name);

  private lastPolledAt: Date | null = null;

  constructor(
    private readonly config: IThinkConfig,
    private readonly tracking: IThinkTrackingService,
    private readonly ingest: IngestTrackingUpdateUseCase,
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

    const now = new Date();
    if (this.lastPolledAt) {
      const minutesElapsed = (now.getTime() - this.lastPolledAt.getTime()) / 60_000;
      if (minutesElapsed < this.config.trackingPollIntervalMinutes) return;
    }

    // Window = configured interval, plus a 2-minute look-back overlap
    // to absorb cron drift. iThink caps the window at 30 min — config
    // schema clamps the interval at 29 so the look-back stays valid.
    const windowMinutes = this.config.trackingPollIntervalMinutes;
    const start = new Date(now.getTime() - (windowMinutes + 2) * 60_000);

    try {
      const awbs = await this.tracking.getAirwaybillsChanged({
        startDateTime: start,
        endDateTime: now,
      });
      if (awbs.length === 0) {
        this.logger.debug(`iThink poll: no AWB changes in last ${windowMinutes}m`);
      } else {
        const { updated, missing } = await this.ingest.ingestForIThink(awbs);
        this.logger.log(
          `iThink poll: ${awbs.length} changed, ${updated} updated, ${missing} orphan`,
        );
      }
      this.lastPolledAt = now;
    } catch (error) {
      // Don't update lastPolledAt on failure — next tick retries the
      // same window so the missed events are picked up.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`iThink poll failed: ${message}`);
    }
  }
}
