/**
 * Phase 1 (PR 1.11) — poller checkpoint port.
 *
 * Persistent cursor for outgoing integration pollers (iThink tracking,
 * future Razorpay status polls, etc.). One row per poller, keyed by a
 * short stable name. The poller writes its `lastPolledAt` on every
 * successful run and reads it back on the next tick so:
 *
 *   - A process restart doesn't lose the cursor → the new window can
 *     be computed from the persisted timestamp instead of fixed
 *     "now − intervalMinutes" (which loses events on long outages).
 *   - Leader bounce → the new leader replica reads the same row the
 *     old one wrote, so it correctly throttles or backfills.
 *
 * Defined as an interface so the cron can be tested against a mock
 * without touching Prisma.
 */
export const POLLER_CHECKPOINT_REPOSITORY = Symbol('PollerCheckpointRepository');

export interface PollerCheckpointRepository {
  /**
   * Read the last persisted poll-completion time for `pollerKey`.
   * Returns `null` when no row exists yet (first run after a fresh
   * deploy, or after the row was manually purged).
   */
  get(pollerKey: string): Promise<Date | null>;

  /**
   * Upsert the cursor. Idempotent — callers don't need to check
   * whether a prior row exists.
   */
  set(pollerKey: string, lastPolledAt: Date): Promise<void>;
}
