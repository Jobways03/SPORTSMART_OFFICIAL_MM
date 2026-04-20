import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test: every background poller gates its sweep behind a
 * Redis lock so multiple API instances don't double-process the same
 * rows. Without the lock, two instances both see the same expired /
 * ready-to-process records and both fire side-effects — double refunds,
 * double stock releases, double auto-rejections, duplicate events.
 *
 * Two specific services were missing the guard this pass:
 *   - FranchiseReservationCleanupService
 *   - OrderTimeoutService
 * Both now acquire/release a well-known lock before running.
 *
 * Source-scan test so a future refactor can't silently drop the guard.
 */

// Pollers that gate their sweep with a Redis lock (the "only-one-
// instance-per-tick" pattern).
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
    '%s uses Redis acquireLock/releaseLock',
    (relativePath) => {
      const absolutePath = join(__dirname, '..', '..', relativePath);
      const source = readFileSync(absolutePath, 'utf8');
      expect(source).toMatch(/acquireLock/);
      expect(source).toMatch(/releaseLock/);
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
