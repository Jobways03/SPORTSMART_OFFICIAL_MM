import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test: every background poller gates its sweep behind a
 * cluster-wide lock so multiple API instances don't double-process the
 * same rows. Without the lock, two instances both see the same expired
 * / ready-to-process records and both fire side-effects — double
 * refunds, double stock releases, double auto-rejections, duplicate
 * events.
 *
 * Two specific services were missing the guard this pass:
 *   - FranchiseReservationCleanupService
 *   - OrderTimeoutService
 * Both now gate the sweep before running.
 *
 * Source-scan test so a future refactor can't silently drop the guard.
 *
 * Two equivalent guard patterns are accepted:
 *   (a) Direct `redis.acquireLock(key)` + `redis.releaseLock(key)` —
 *       the legacy un-fenced pair. Still used by pollers that pre-date
 *       Phase 1.
 *   (b) `LeaderElectedCron.run(jobName, ttl, body)` (a.k.a.
 *       `leader.run(...)`) — the fenced token-CAS variant introduced
 *       in PR 1.7. Internally calls `acquireLockWithToken` +
 *       `releaseLockWithToken`; the meta-test just needs to see the
 *       wrapper invocation.
 *
 * Either pattern satisfies the "one replica per tick" invariant. New
 * migrations should prefer (b) since it closes the TTL-expired-mid-work
 * race window. PR 1.8 migrated franchise-reservation-cleanup from (a)
 * to (b); accepting both prevents that migration from regressing this
 * guard.
 */

// Pollers that gate their sweep with a cluster-wide lock — either
// direct `acquireLock`/`releaseLock` or `LeaderElectedCron.run` /
// `leader.run` count as gated.
const POLLERS_WITH_REDIS_LOCK = [
  'src/modules/commission/application/services/commission-processor.service.ts',
  'src/modules/payments/application/services/payment-status-poller.service.ts',
  'src/modules/returns/application/services/refund-processor.service.ts',
  'src/modules/returns/application/services/stale-return-processor.service.ts',
  'src/modules/accounts/application/services/settlement-cycle-processor.service.ts',
  'src/modules/franchise/application/services/franchise-commission-processor.service.ts',
  'src/modules/franchise/application/services/franchise-reservation-cleanup.service.ts',
  'src/modules/orders/application/services/order-timeout.service.ts',
];

// seller-allocation.service.ts uses an equivalent safety pattern —
// atomic-claim on the row itself via updateMany({where: {status:
// RESERVED}, data: {status: EXPIRED}}) inside a transaction. Only the
// winning updateMany gets `count === 1` and proceeds to decrement
// reservedQty; the loser no-ops. Structurally different from the Redis
// lock but equivalent for the "no double-process" property.
const POLLERS_WITH_ATOMIC_CLAIM = [
  'src/modules/catalog/application/services/seller-allocation.service.ts',
];

describe('background pollers — per-tick concurrency guard', () => {
  it.each(POLLERS_WITH_REDIS_LOCK)(
    '%s gates the sweep behind a cluster-wide lock',
    (relativePath) => {
      const absolutePath = join(__dirname, '..', '..', relativePath);
      const source = readFileSync(absolutePath, 'utf8');

      // Pattern (a) — legacy direct acquireLock/releaseLock pair.
      const usesDirectLockPair =
        /acquireLock\s*\(/.test(source) && /releaseLock\s*\(/.test(source);

      // Pattern (b) — fenced LeaderElectedCron wrapper. `leader.run(...)`
      // is the call site; importing `LeaderElectedCron` is the type
      // dependency. Either one alone would be brittle (the import could
      // be unused, or the wrapper could be aliased), so we require both.
      const usesLeaderElectedCron =
        /LeaderElectedCron/.test(source) && /\bleader\.run\s*\(/.test(source);

      expect(usesDirectLockPair || usesLeaderElectedCron).toBe(true);
    },
  );

  it.each(POLLERS_WITH_ATOMIC_CLAIM)(
    '%s uses atomic updateMany claim on the swept rows',
    (relativePath) => {
      const absolutePath = join(__dirname, '..', '..', relativePath);
      const source = readFileSync(absolutePath, 'utf8');
      // The expiry path wins the row via updateMany conditioned on the
      // "still reservable" state — losers get count: 0 and skip the
      // decrement side-effect.
      expect(source).toMatch(/updateMany/);
      expect(source).toMatch(/claim\.count\s*===\s*0/);
    },
  );
});
