import { Logger } from '@nestjs/common';

/**
 * Decorator/wrapper placeholder for cluster-wide leader-elected cron
 * execution. The full apps/api implementation uses a Redis lock
 * (SET NX EX) so only one replica runs the periodic body. M0 ships
 * the file with the contract but a passthrough body — every replica
 * runs the cron once. Safe for stubs (no crons actually defined yet)
 * but MUST be replaced before any real partner-side polling crons
 * land, or the M3 reconciliation job will pull the same remittance
 * file from every replica.
 *
 * To migrate from this stub to the real lock:
 *   1. Inject RedisService.
 *   2. SET NX EX <lockKey> <ttl> with the replica id.
 *   3. Run the body if we won the lock; release the key in a finally.
 *   4. Mirror apps/api/src/bootstrap/scheduler/leader-elected-cron.ts
 *      for the renewal / observation pattern.
 */
export interface LeaderElectedCronOptions {
  /** Stable lock key. Use the cron's dotted name (e.g. cod.remittance.pull). */
  key: string;
  /** Lock TTL in seconds. Should cover the longest expected run + grace. */
  ttlSeconds?: number;
}

const logger = new Logger('LeaderElectedCron');

export async function runWithLeaderLock<T>(
  options: LeaderElectedCronOptions,
  body: () => Promise<T>,
): Promise<T | undefined> {
  // TODO(M1): acquire a Redis lock here. M0 fallback: log the intent
  // and run the body unconditionally. Every replica will execute —
  // acceptable while no cron bodies actually exist yet.
  logger.warn(
    `Running cron ${options.key} WITHOUT cluster lock — replace with Redis lock before M3 remittance crons.`,
  );
  return body();
}
