import { AdminTaskSlaBreachCron } from './admin-task-sla-breach.cron';

/**
 * Phase 0 (PR 0.14) — admin-task SLA-breach detector.
 *
 *   - When enabled and tasks are past slaBreachAt with slaBreachedAt=null:
 *       1. Marks slaBreachedAt=now (CAS via updateMany WHERE slaBreachedAt IS NULL).
 *       2. Emits the right event per task kind.
 *   - When disabled (flag off): no DB / event traffic.
 *   - Won't double-fire across replicas (CAS guard).
 *   - REFUND_INSTRUCTION_FAILED routes to `disputes.refund_failure.sla_breached`.
 */

function buildCron(opts: {
  enabled?: boolean;
  breached?: Array<{
    id: string;
    kind: string;
    sourceType: string;
    sourceId: string;
    reason: string;
    slaBreachAt: Date | null;
    assignedTo: string | null;
  }>;
  /** Toggle CAS-update result. */
  updateManyCount?: number;
}) {
  const findMany = jest.fn().mockResolvedValue(opts.breached ?? []);
  const updateMany = jest.fn().mockResolvedValue({
    count: opts.updateManyCount ?? 1,
  });

  const prisma = { adminTask: { findMany, updateMany } } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const env = {
    getBoolean: jest.fn().mockReturnValue(opts.enabled ?? true),
  } as any;
  // Phase 1 (PR 1.2) — leader stub: always grant the lock so the
  // existing tests exercise the inner logic. A separate "skip when
  // leader elsewhere" test would belong with the helper spec.
  const leader = {
    run: jest.fn(async (_name: string, _ttl: number, body: () => Promise<void>) => {
      await body();
      return { ran: true };
    }),
  } as any;
  // Phase 5 (PR 5.2) — pass-through instr so existing assertions
  // about findMany / updateMany / eventBus calls still hold.
  const instr = {
    wrap: jest.fn(async (_n: string, fn: () => Promise<unknown>) => fn()),
  } as any;

  const cron = new AdminTaskSlaBreachCron(prisma, eventBus, env, leader, instr);
  return { cron, prisma, eventBus, env, findMany, updateMany, leader, instr };
}

describe('AdminTaskSlaBreachCron — PR 0.14', () => {
  it('is a no-op when the env flag is off', async () => {
    const { cron, findMany } = buildCron({ enabled: false });
    await cron.sweep();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('marks slaBreachedAt and emits disputes.refund_failure.sla_breached for REFUND_INSTRUCTION_FAILED', async () => {
    const { cron, eventBus, updateMany } = buildCron({
      breached: [
        {
          id: 'task-1',
          kind: 'REFUND_INSTRUCTION_FAILED',
          sourceType: 'DISPUTE',
          sourceId: 'd-1',
          reason: 'wallet step failed',
          slaBreachAt: new Date('2026-01-01T00:00:00Z'),
          assignedTo: null,
        },
      ],
    });

    await cron.sweep();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'task-1', slaBreachedAt: null },
      data: { slaBreachedAt: expect.any(Date) },
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'disputes.refund_failure.sla_breached',
        aggregateId: 'task-1',
        payload: expect.objectContaining({
          adminTaskId: 'task-1',
          kind: 'REFUND_INSTRUCTION_FAILED',
          sourceType: 'DISPUTE',
          sourceId: 'd-1',
        }),
      }),
    );
  });

  it('emits the generic event for non-refund kinds', async () => {
    const { cron, eventBus } = buildCron({
      breached: [
        {
          id: 'task-2',
          kind: 'LOGISTICS_CLAIM_REVIEW',
          sourceType: 'RETURN',
          sourceId: 'r-1',
          reason: 'courier denial',
          slaBreachAt: new Date('2026-01-01T00:00:00Z'),
          assignedTo: 'admin-7',
        },
      ],
    });

    await cron.sweep();

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'liability.admin_task.sla_breached',
        payload: expect.objectContaining({
          assignedTo: 'admin-7',
        }),
      }),
    );
  });

  it('does NOT emit when another replica already flipped slaBreachedAt (CAS lost)', async () => {
    const { cron, eventBus } = buildCron({
      breached: [
        {
          id: 'task-3',
          kind: 'REFUND_INSTRUCTION_FAILED',
          sourceType: 'DISPUTE',
          sourceId: 'd-3',
          reason: 'race',
          slaBreachAt: new Date('2026-01-01T00:00:00Z'),
          assignedTo: null,
        },
      ],
      updateManyCount: 0, // CAS lost
    });

    await cron.sweep();

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('processes multiple breached tasks in one tick', async () => {
    const { cron, eventBus } = buildCron({
      breached: [
        { id: 'task-A', kind: 'REFUND_INSTRUCTION_FAILED', sourceType: 'DISPUTE', sourceId: 'd-A', reason: 'a', slaBreachAt: new Date(0), assignedTo: null },
        { id: 'task-B', kind: 'REFUND_INSTRUCTION_FAILED', sourceType: 'DISPUTE', sourceId: 'd-B', reason: 'b', slaBreachAt: new Date(0), assignedTo: null },
        { id: 'task-C', kind: 'SELLER_DEBIT_DISPUTED', sourceType: 'MANUAL', sourceId: 's-C', reason: 'c', slaBreachAt: new Date(0), assignedTo: null },
      ],
    });

    await cron.sweep();

    expect(eventBus.publish).toHaveBeenCalledTimes(3);
    const eventNames = eventBus.publish.mock.calls.map((c: any) => c[0].eventName);
    expect(eventNames).toEqual([
      'disputes.refund_failure.sla_breached',
      'disputes.refund_failure.sla_breached',
      'liability.admin_task.sla_breached',
    ]);
  });

  it('queries only OPEN/CLAIMED tasks past slaBreachAt with slaBreachedAt null', async () => {
    const { cron, findMany } = buildCron({ breached: [] });
    await cron.sweep();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['OPEN', 'CLAIMED'] },
          slaBreachAt: { lte: expect.any(Date) },
          slaBreachedAt: null,
        }),
      }),
    );
  });
});
