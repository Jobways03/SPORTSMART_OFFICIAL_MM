import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppLoggerService } from './app-logger.service';
import { EventBusService } from '../events/event-bus.service';

/**
 * Phase 5 (PR 5.8) — in-process HTTP 5xx burst detector.
 *
 * The PR 5.7 histogram gives Prometheus the data it needs to alert
 * via PromQL — this monitor adds a faster, scrape-independent path:
 *
 *   - Signal latency < a single request (the moment threshold is
 *     crossed, the event fires).
 *   - Works during a Prometheus / alertmanager outage.
 *   - Emits a domain event that the notification module already
 *     subscribes to → Slack ping without extra wiring.
 *
 * Design: fixed-window error count + cooldown. A 5xx-storm at
 * 10:00:00 crosses the threshold at 10:00:30, emits one event, then
 * sleeps for `cooldownMs` even if the storm continues for 10 minutes.
 * Cooldown prevents an event-bus storm; the receiver (Slack)
 * naturally inherits the same "alert once per N minutes" behavior.
 *
 * Why fixed-window over sliding-window: simpler, deterministic,
 * lower memory. Sliding-window adds <5% accuracy in practice and
 * costs O(N) per record. For burst detection at 10-events/minute
 * granularity, fixed is fine.
 *
 * Memory model: an array of error-timestamps, pruned on each record
 * to drop entries older than `windowMs`. Bounded above by
 * `windowMs / response-rate` — at 1000 5xx/s for 60s that's 60k
 * timestamps × 8 bytes ≈ 480kb worst case. Below that on every
 * realistic env.
 */

export interface HttpErrorRateConfig {
  /** Number of 5xx within the window that triggers an event. */
  threshold: number;
  /** Rolling window length in milliseconds. */
  windowMs: number;
  /**
   * After firing, suppress further events for this many milliseconds
   * even if the threshold is still being exceeded. Prevents a
   * sustained storm from emitting N copies of the same alert.
   */
  cooldownMs: number;
}

@Injectable()
export class HttpErrorRateMonitor {
  private readonly errorTimestamps: number[] = [];
  private lastFiredAt: number | null = null;

  constructor(
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    @Optional() @Inject('HTTP_ERROR_RATE_CONFIG')
    private readonly config: HttpErrorRateConfig = {
      threshold: 10,
      windowMs: 60_000,
      cooldownMs: 300_000,
    },
  ) {}

  /**
   * Call from the request-finish path with the response status code.
   * Non-5xx statuses are no-ops. Async so the event-bus publish can
   * be awaited, but the caller (middleware) should fire-and-forget.
   */
  async recordStatus(status: number): Promise<void> {
    if (status < 500 || status >= 600) return;

    const now = Date.now();
    this.pruneOldEntries(now);
    this.errorTimestamps.push(now);

    if (this.errorTimestamps.length < this.config.threshold) return;
    if (this.isInCooldown(now)) return;

    this.lastFiredAt = now;
    const firstErrorAt = new Date(this.errorTimestamps[0]).toISOString();
    const count = this.errorTimestamps.length;
    const windowSeconds = Math.floor(this.config.windowMs / 1000);

    this.logger.warn(
      `[HTTP-5XX-BURST] ${count} 5xx responses in last ${windowSeconds}s ` +
        `(threshold=${this.config.threshold}); first at ${firstErrorAt}`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'http.error_rate.elevated',
        aggregate: 'HttpErrorRate',
        aggregateId: 'singleton',
        occurredAt: new Date(now),
        payload: {
          count,
          thresholdN: this.config.threshold,
          windowSeconds,
          firstErrorAt,
        },
      });
    } catch (err) {
      // Never let a wedged event-bus / outbox propagate to the
      // request path. The log line above is the durable signal;
      // the event is best-effort.
      this.logger.error(
        `Failed to emit http.error_rate.elevated event: ${(err as Error).message}`,
      );
    }
  }

  /** Drop entries older than `windowMs`. Linear in the number of
   *  expired entries; the array stays sorted by insertion order
   *  (which is timestamp order) so this is O(k) where k is the
   *  number we drop, not O(n). */
  private pruneOldEntries(now: number): void {
    const cutoff = now - this.config.windowMs;
    let dropCount = 0;
    while (
      dropCount < this.errorTimestamps.length &&
      this.errorTimestamps[dropCount] < cutoff
    ) {
      dropCount++;
    }
    if (dropCount > 0) this.errorTimestamps.splice(0, dropCount);
  }

  private isInCooldown(now: number): boolean {
    return (
      this.lastFiredAt !== null &&
      now - this.lastFiredAt < this.config.cooldownMs
    );
  }
}
