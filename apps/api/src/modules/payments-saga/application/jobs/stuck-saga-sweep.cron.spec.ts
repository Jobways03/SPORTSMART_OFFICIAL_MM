import { StuckSagaSweepCron } from './stuck-saga-sweep.cron';

/**
 * Phase 1 (PR 1.5) — stuck-saga sweep.
 *
 * Contract:
 *   - Disabled when `REFUND_SAGA_SWEEP_ENABLED=false`.
 *   - Finds sagas with `status ∈ (STARTED, IN_PROGRESS)` past the
 *     stuck threshold AND `completedAt IS NULL`.
 *   - CAS-flips each to FAILED via `updateMany WHERE status IN (...)`;
 *     CAS lost → no side-effects (multi-replica safety).
 *   - CAS won → enqueue an admin task with 4-hour SLA + emit
 *     `payments.saga.stuck_auto_escalated`.
 *   - `RefundSourceType.REPLACEMENT` maps to `LedgerSourceType.MANUAL`
 *     for the admin task (extra-value membership case).
 */

function buildCron(opts: {
  enabled?: boolean;
  stuckMinutes?: number;
  sagas?: Array<{
    id: string;
    refundType: string;
    sourceId: string;
    customerId: string;
    amountInPaise: bigint;
    startedAt: Date;
    status: string;
  }>;
  updateManyCount?: number; // simulate CAS won (1) or lost (0)
  enqueueImpl?: (...args: any[]) => Promise<any>;
}) {
  const findMany = jest.fn().mockResolvedValue(opts.sagas ?? []);
  const updateMany = jest.fn().mockResolvedValue({
    count: opts.updateManyCount ?? 1,
  });

  const prisma = { refundSaga: { findMany, updateMany } } as any;
  const env = {
    getBoolean: jest.fn().mockReturnValue(opts.enabled ?? true),
    getNumber: jest.fn().mockReturnValue(opts.stuckMinutes ?? 5),
  } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const leader = {
    run: jest.fn(async (_n: string, _t: number, body: () => Promise<void>) => {
      await body();
      return { ran: true };
    }),
  } as any;
  const ledger = {
    enqueueAdminTask: opts.enqueueImpl
      ? jest.fn(opts.enqueueImpl)
      : jest.fn().mockResolvedValue(undefined),
  } as any;
  // Phase 5 (PR 5.1) — pass-through wrap so existing assertions on
  // side-effects (findMany, eventBus.publish) still hold. The new
  // PR 5.1 tests below mock this explicitly.
  const instr = {
    wrap: jest.fn(async (_n: string, fn: () => Promise<unknown>) => fn()),
  } as any;

  const cron = new StuckSagaSweepCron(prisma, env, eventBus, leader, ledger, instr);
  return { cron, prisma, env, eventBus, leader, ledger, findMany, updateMany, instr };
}

const aMinuteAgo = (mins: number) =>
  new Date(Date.now() - mins * 60_000);

describe('StuckSagaSweepCron — Phase 1 PR 1.5', () => {
  it('is a no-op when the env flag is off', async () => {
    const { cron, findMany } = buildCron({ enabled: false });
    await cron.sweep();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('CAS-flips a stuck saga to FAILED and fires the escalation side-effects', async () => {
    const { cron, eventBus, ledger, updateMany } = buildCron({
      sagas: [
        {
          id: 'saga-1',
          refundType: 'DISPUTE',
          sourceId: 'dispute-7',
          customerId: 'cust-7',
          amountInPaise: 50_000n,
          startedAt: aMinuteAgo(10), // 10 min old, default threshold 5 min
          status: 'IN_PROGRESS',
        },
      ],
    });

    await cron.sweep();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'saga-1',
        status: { in: ['STARTED', 'IN_PROGRESS'] },
        completedAt: null,
      },
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: expect.stringContaining('STUCK_AUTO_ESCALATED'),
        completedAt: expect.any(Date),
      }),
    });

    expect(ledger.enqueueAdminTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'REFUND_INSTRUCTION_FAILED',
        sourceType: 'DISPUTE',
        sourceId: 'dispute-7',
        slaHours: 4,
      }),
    );

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'payments.saga.stuck_auto_escalated',
        aggregateId: 'saga-1',
        payload: expect.objectContaining({
          sagaId: 'saga-1',
          refundType: 'DISPUTE',
          amountInPaise: '50000',
        }),
      }),
    );
  });

  it('does NOT fire side-effects when CAS is lost (another replica already flipped it)', async () => {
    const { cron, eventBus, ledger } = buildCron({
      sagas: [
        {
          id: 'saga-race',
          refundType: 'RETURN',
          sourceId: 'r-1',
          customerId: 'c-1',
          amountInPaise: 1000n,
          startedAt: aMinuteAgo(10),
          status: 'STARTED',
        },
      ],
      updateManyCount: 0, // CAS lost
    });

    await cron.sweep();

    expect(ledger.enqueueAdminTask).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('processes multiple stuck sagas in one tick', async () => {
    const { cron, eventBus, ledger } = buildCron({
      sagas: [
        { id: 'sg-A', refundType: 'DISPUTE',  sourceId: 'd-A', customerId: 'c', amountInPaise: 100n, startedAt: aMinuteAgo(7),  status: 'IN_PROGRESS' },
        { id: 'sg-B', refundType: 'RETURN',   sourceId: 'r-B', customerId: 'c', amountInPaise: 200n, startedAt: aMinuteAgo(8),  status: 'IN_PROGRESS' },
        { id: 'sg-C', refundType: 'GOODWILL', sourceId: 'g-C', customerId: 'c', amountInPaise: 300n, startedAt: aMinuteAgo(20), status: 'STARTED' },
      ],
    });

    await cron.sweep();

    expect(ledger.enqueueAdminTask).toHaveBeenCalledTimes(3);
    expect(eventBus.publish).toHaveBeenCalledTimes(3);
  });

  it('maps RefundSourceType.REPLACEMENT to LedgerSourceType.MANUAL for the admin task', async () => {
    const { cron, ledger } = buildCron({
      sagas: [
        {
          id: 'sg-rep',
          refundType: 'REPLACEMENT', // extra value not in LedgerSourceType
          sourceId: 'replace-1',
          customerId: 'c-1',
          amountInPaise: 7000n,
          startedAt: aMinuteAgo(15),
          status: 'IN_PROGRESS',
        },
      ],
    });

    await cron.sweep();

    expect(ledger.enqueueAdminTask).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'MANUAL' }),
    );
  });

  it('continues even when enqueueAdminTask throws (logged, not propagated)', async () => {
    const { cron, eventBus, ledger } = buildCron({
      sagas: [
        {
          id: 'sg-task-fail',
          refundType: 'DISPUTE',
          sourceId: 'd-x',
          customerId: 'c',
          amountInPaise: 1n,
          startedAt: aMinuteAgo(10),
          status: 'IN_PROGRESS',
        },
      ],
      enqueueImpl: async () => {
        throw new Error('ledger DB outage');
      },
    });

    await cron.sweep();

    // The CAS won, the event still fires, but the admin task throw
    // was caught — sweep does not unwind because the FAILED status
    // is the load-bearing safety; the task is best-effort.
    expect(ledger.enqueueAdminTask).toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalled();
  });

  it('queries the right shape: status IN, age > threshold, not completed', async () => {
    const { cron, findMany } = buildCron({ stuckMinutes: 7 });
    await cron.sweep();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['STARTED', 'IN_PROGRESS'] },
          startedAt: { lt: expect.any(Date) },
          completedAt: null,
        }),
      }),
    );
  });

  it('uses LeaderElectedCron wrapper (multi-replica guard)', async () => {
    const { cron, leader } = buildCron({ sagas: [] });
    await cron.sweep();
    expect(leader.run).toHaveBeenCalledWith(
      'stuck-saga-sweep',
      expect.any(Number),
      expect.any(Function),
    );
  });
});

describe('StuckSagaSweepCron — cron-run observability (PR 5.1)', () => {
  it('wraps every sweep through instr.wrap with the canonical job name', async () => {
    const { cron, instr } = buildCron({ sagas: [] });
    await cron.sweep();
    expect(instr.wrap).toHaveBeenCalledTimes(1);
    expect(instr.wrap.mock.calls[0][0]).toBe('stuck-saga-sweep');
  });

  it('empty sweep returns { scanned: 0, escalated: 0 } so cron_runs.result is queryable', async () => {
    let captured: unknown;
    const { cron, instr } = buildCron({ sagas: [] });
    instr.wrap.mockImplementation(async (_n: string, fn: () => Promise<unknown>) => {
      captured = await fn();
      return captured;
    });
    await cron.sweep();
    expect(captured).toEqual({ scanned: 0, escalated: 0 });
  });

  it('on sweep error, instr.wrap re-throws → outer try/catch swallows at sweep boundary', async () => {
    const { cron, instr, prisma } = buildCron({ sagas: [] });
    prisma.refundSaga.findMany.mockRejectedValueOnce(new Error('DB unreachable'));
    instr.wrap.mockImplementation(async (_n: string, fn: () => Promise<unknown>) => {
      try {
        return await fn();
      } catch (err) {
        throw err; // simulate real wrap recording FAILED then re-throwing
      }
    });
    // sweep() must NOT propagate — outer try/catch swallows
    await expect(cron.sweep()).resolves.toBeUndefined();
    expect(instr.wrap).toHaveBeenCalledTimes(1);
  });
});
