import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../cache/redis.service';

/**
 * Phase 1 (PR 1.1) — `LeaderElectedCron` wrapper.
 *
 * Every `@Cron()` decorator in this codebase registers on EVERY replica
 * because `@nestjs/schedule` runs in-process. With N replicas, a 02:00
 * "daily reconciliation" cron fires N times concurrently, producing
 * duplicate emails / N-way recon rows / double-decremented stock /
 * double ticket-escalation. The audit flagged this as the single
 * highest-priority production risk in the codebase.
 *
 * This helper wraps a cron body with a Redis SET-NX lock so only ONE
 * replica per cluster runs the body per scheduled tick:
 *
 *   @Cron(CronExpression.EVERY_HOUR)
 *   async dailyReconciliation() {
 *     await this.leader.run('daily-reconciliation', 3600, async () => {
 *       // existing body
 *     });
 *   }
 *
 * Contract:
 *   - `jobName` is the Redis key suffix (`cron-lock:${jobName}`); each
 *     job must have a unique name across the cluster.
 *   - `ttlSeconds` is the lock LEASE, auto-renewed by the watchdog every
 *     ~ttl/3s while the body runs (so a body that outlives ttlSeconds keeps
 *     its lock instead of letting a second replica in). Pick a ttl that is a
 *     comfortable multiple of the renew interval and survives a brief Redis
 *     blip (a few renewals' worth, e.g. >= 30s), and small enough that a
 *     CRASHED leader's lock expires reasonably soon (no renewals fire after a
 *     crash, so the lease is also the crash-recovery window).
 *   - On uncaught body errors: lock is released via `finally`, then
 *     the error re-propagates so `@nestjs/schedule` records it.
 *
 * Returns `{ ran: boolean }` so the caller can record metrics
 * (the wrapper itself doesn't increment counters today; PR 5.4 will
 * fold cron metrics in here).
 *
 * PR 1.7 — fenced release is now implemented. Each acquire mints
 * a per-call UUID token; release does a Lua CAS that only deletes
 * the key if the value still matches the token. A holder whose TTL
 * expired mid-run can no longer accidentally delete a successor's
 * lock.
 *
 * Lease renewal (watchdog) — IMPLEMENTED. While the body runs, a timer
 * re-extends the lock TTL every ~ttl/3s via a fenced CAS (renewLockWithToken:
 * extend only if the value still matches our token), so a body that outlives
 * ttlSeconds keeps its lock instead of being revoked mid-run. The timer is
 * cleared before release. Renewal is best-effort — a sustained Redis outage
 * can still let the lease lapse — so it shrinks the double-run window rather
 * than being a hard distributed-lock guarantee.
 */
@Injectable()
export class LeaderElectedCron {
  private readonly logger = new Logger(LeaderElectedCron.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Acquire the cluster-wide lock for `jobName`, run `body`, release.
   * Returns whether the body actually ran on this replica.
   */
  async run(
    jobName: string,
    ttlSeconds: number,
    body: () => Promise<void>,
  ): Promise<{ ran: boolean }> {
    if (!jobName || jobName.includes(' ')) {
      // Defensive: bad jobName produces a malformed Redis key.
      throw new Error(`LeaderElectedCron: jobName must be non-empty no-spaces, got '${jobName}'`);
    }
    if (ttlSeconds <= 0) {
      throw new Error(`LeaderElectedCron: ttlSeconds must be > 0, got ${ttlSeconds}`);
    }

    const lockKey = `cron-lock:${jobName}`;
    // Phase 1 (PR 1.7) — fenced acquire. The returned token is
    // matched at release time so a TTL-expired holder can't delete
    // a successor's lock.
    const { acquired, token } = await this.redis.acquireLockWithToken(
      lockKey,
      ttlSeconds,
    );
    if (!acquired || !token) {
      this.logger.debug(`cron '${jobName}' skipped — leader elsewhere`);
      return { ran: false };
    }

    // Lease-renewal watchdog. A body that runs longer than ttlSeconds would
    // otherwise let the lock expire mid-run, allowing a second replica to
    // acquire and run concurrently. Re-extend the TTL every ~ttl/3s, fenced
    // (only if we still hold it). Renewal failure (we lost the lock, or a
    // transient Redis error) is logged but cannot abort the in-flight body —
    // the watchdog shrinks the double-run window for slow-but-healthy jobs; it
    // is not a hard guarantee under sustained Redis failure.
    const renewMs = Math.max(1000, Math.floor((ttlSeconds * 1000) / 3));
    const watchdog = setInterval(() => {
      void this.redis
        .renewLockWithToken(lockKey, token, ttlSeconds)
        .then((renewed) => {
          if (!renewed) {
            this.logger.warn(
              `cron '${jobName}' lock renewal did not extend (lock lost or Redis error) — a concurrent run is possible`,
            );
          }
        })
        .catch(() => undefined);
    }, renewMs);
    // Don't let the watchdog timer keep the event loop alive.
    watchdog.unref?.();

    const startedAt = Date.now();
    try {
      await body();
      const elapsedMs = Date.now() - startedAt;
      this.logger.log(`cron '${jobName}' completed in ${elapsedMs}ms`);
      return { ran: true };
    } finally {
      // Stop renewing BEFORE releasing so a late renew can't re-extend a lock
      // we're about to delete (and even if one races, its fenced CAS no-ops
      // once the key is gone).
      clearInterval(watchdog);
      // Fenced release — only deletes the key if our token still
      // matches. If TTL expired mid-body, the release is a no-op
      // (returns false) instead of clobbering a fresh acquirer's lock.
      await this.redis.releaseLockWithToken(lockKey, token).catch((err) =>
        this.logger.error(
          `cron '${jobName}' lock release failed: ${err?.message ?? err}`,
        ),
      );
    }
  }
}
