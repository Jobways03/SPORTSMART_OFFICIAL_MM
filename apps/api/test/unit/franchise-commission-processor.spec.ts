import 'reflect-metadata';
import { FranchiseCommissionProcessorService } from '../../src/modules/franchise/application/services/franchise-commission-processor.service';

/**
 * Regression tests for the franchise commission processor's concurrency
 * safety:
 *   - It uses the FENCED lock (acquireLockWithToken / releaseLockWithToken),
 *     NOT the unfenced acquireLock/releaseLock pair (which could DEL a
 *     successor's lock after a TTL-expiry mid-batch).
 *   - It RECORDS first (idempotent via the ledger @unique key) THEN marks
 *     commissionProcessed atomically + conditionally, so a crash between the
 *     two retries safely (no stranded/lost commission) and commission.locked
 *     is published exactly once (gated on winning the mark).
 *   - A recording failure leaves the row unmarked → a later tick retries.
 */

const LOCK_KEY = 'lock:franchise-commission-processor';

function build() {
  const redis = {
    acquireLockWithToken: jest
      .fn()
      .mockResolvedValue({ acquired: true, token: 'tok-1' }),
    releaseLockWithToken: jest.fn().mockResolvedValue(true),
    // must NOT be used anymore (unfenced)
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  };
  const prisma = {
    subOrder: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const commissionService = {
    recordOnlineOrderCommission: jest.fn().mockResolvedValue(undefined),
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const service = new FranchiseCommissionProcessorService(
    prisma as any,
    redis as any,
    commissionService as any,
    eventBus as any,
    logger as any,
  );
  return { service, redis, prisma, commissionService, eventBus };
}

const eligibleSubOrder = () => ({
  id: 'so-1',
  franchiseId: 'fr-1',
  masterOrderId: 'mo-1',
  commissionRateSnapshot: null,
  items: [{ unitPrice: 100, quantity: 2 }],
  masterOrder: { orderNumber: 'ORD-1' },
  franchise: { id: 'fr-1', onlineFulfillmentRate: 10 },
});

describe('FranchiseCommissionProcessorService — fenced lock + record-then-mark', () => {
  it('uses the FENCED lock and records-then-marks a won sub-order exactly once', async () => {
    const { service, redis, prisma, commissionService, eventBus } = build();
    prisma.subOrder.findMany.mockResolvedValue([eligibleSubOrder()]);
    prisma.subOrder.updateMany.mockResolvedValue({ count: 1 }); // mark wins

    await service.processCommissions();

    // Fenced primitives only — the unfenced pair must be gone.
    expect(redis.acquireLockWithToken).toHaveBeenCalledWith(LOCK_KEY, 30);
    expect(redis.releaseLockWithToken).toHaveBeenCalledWith(LOCK_KEY, 'tok-1');
    expect(redis.acquireLock).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();

    // Record FIRST (idempotent), then the atomic conditional mark.
    expect(commissionService.recordOnlineOrderCommission).toHaveBeenCalledTimes(
      1,
    );
    // The mark re-validates no-live-return / no-active-dispute INSIDE the
    // claim (closes the eligibility→mark TOCTOU, mirrors the seller side).
    expect(prisma.subOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'so-1',
        commissionProcessed: false,
        NOT: {
          returns: {
            some: { status: { notIn: ['REJECTED', 'QC_REJECTED', 'CANCELLED'] } },
          },
        },
        disputes: {
          none: {
            status: {
              notIn: ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'CLOSED'],
            },
          },
        },
      },
      data: { commissionProcessed: true },
    });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('eligibility excludes sub-orders with a live return or an active dispute', async () => {
    const { service, prisma } = build();
    prisma.subOrder.findMany.mockResolvedValue([]); // none eligible this tick
    prisma.subOrder.updateMany.mockResolvedValue({ count: 0 });

    await service.processCommissions();

    const where = prisma.subOrder.findMany.mock.calls[0][0].where;
    // Any return not in the terminal-failed set blocks the lock…
    expect(where.NOT).toEqual({
      returns: {
        some: { status: { notIn: ['REJECTED', 'QC_REJECTED', 'CANCELLED'] } },
      },
    });
    // …and any dispute outside RESOLVED_*/CLOSED blocks it too.
    expect(where.disputes).toEqual({
      none: {
        status: {
          notIn: ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'CLOSED'],
        },
      },
    });
  });

  it('does NOT double-publish commission.locked when another worker already marked the row', async () => {
    const { service, prisma, eventBus } = build();
    prisma.subOrder.findMany.mockResolvedValue([eligibleSubOrder()]);
    prisma.subOrder.updateMany.mockResolvedValue({ count: 0 }); // lost the mark

    await service.processCommissions();

    // The idempotent record may run, but the notification is gated on the mark.
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('leaves the row unmarked when recording fails, so a later tick retries', async () => {
    const { service, prisma, commissionService, eventBus } = build();
    prisma.subOrder.findMany.mockResolvedValue([eligibleSubOrder()]);
    commissionService.recordOnlineOrderCommission.mockRejectedValue(
      new Error('ledger down'),
    );

    await service.processCommissions();

    // Record threw BEFORE the mark → commissionProcessed stays false (no
    // mark write, no event). The next tick re-records (idempotent) + marks.
    expect(prisma.subOrder.updateMany).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('does nothing when the lock is not acquired', async () => {
    const { service, redis, prisma } = build();
    redis.acquireLockWithToken.mockResolvedValue({
      acquired: false,
      token: null,
    });

    await service.processCommissions();

    expect(prisma.subOrder.findMany).not.toHaveBeenCalled();
    expect(redis.releaseLockWithToken).not.toHaveBeenCalled();
  });
});
