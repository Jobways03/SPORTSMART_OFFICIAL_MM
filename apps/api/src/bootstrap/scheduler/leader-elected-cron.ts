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
 *   - `ttlSeconds` MUST be at least `2 * expectedBodyDurationSeconds`.
 *     A too-short TTL means the lock expires mid-run and another
 *     replica picks up. A too-long TTL means a crashed leader blocks
 *     reruns until expiry. Tune per-job; default rule of thumb is
 *     `2 * tick_interval`.
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
 * NOT IMPLEMENTED YET:
 *   - Lease renewal. A long-running body that exceeds TTL gets its
 *     lock revoked. Today: tune TTL conservatively.
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

    const startedAt = Date.now();
    try {
      await body();
      const elapsedMs = Date.now() - startedAt;
      this.logger.log(`cron '${jobName}' completed in ${elapsedMs}ms`);
      return { ran: true };
    } finally {
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
