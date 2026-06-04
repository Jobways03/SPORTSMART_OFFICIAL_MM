import { EventBusService } from '../event-bus.service';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxDlqService } from './outbox-dlq.service';
import { OutboxRetentionCron } from './outbox-retention.cron';
import { AdminOutboxController } from './admin-outbox.controller';

// Phase 186 — Notification Outbox Publisher Cron audit remediation.

function envMock(overrides: Record<string, any> = {}) {
  return {
    getBoolean: (k: string, d = false) => overrides[k] ?? d,
    getNumber: (k: string, d = 0) => (k in overrides ? overrides[k] : d),
    getString: (k: string, d = '') => overrides[k] ?? d,
  } as any;
}

describe('#9 EventBus payload-size cap', () => {
  function make(env: any) {
    const emitter: any = { emitAsync: jest.fn().mockResolvedValue(undefined) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const prisma: any = { outboxEvent: { create: jest.fn() }, $executeRaw: jest.fn() };
    return { bus: new EventBusService(emitter, logger, prisma, env), prisma };
  }
  const event = (payload: unknown) => ({
    eventName: 'x.y', aggregate: 'A', aggregateId: '1', occurredAt: new Date(), payload,
  });

  it('throws when the payload exceeds the cap', async () => {
    const { bus } = make(envMock({ OUTBOX_MAX_PAYLOAD_BYTES: 100 }));
    await expect(bus.publish(event({ big: 'x'.repeat(500) }))).rejects.toThrow(/exceeding/);
  });

  it('allows a payload within the cap', async () => {
    const { bus } = make(envMock({ OUTBOX_MAX_PAYLOAD_BYTES: 100_000 }));
    await expect(bus.publish(event({ ok: true }))).resolves.toBeUndefined();
  });
});

describe('#1 EventBus debounce merge', () => {
  function make(dualWrite: boolean) {
    const env = envMock({ OUTBOX_DUAL_WRITE: dualWrite, OUTBOX_MAX_PAYLOAD_BYTES: 1_000_000, OUTBOX_DEBOUNCE_DEFAULT_MS: 30_000, OUTBOX_AUTHORITATIVE: true });
    const emitter: any = { emitAsync: jest.fn().mockResolvedValue(undefined) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const prisma: any = {
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    return { bus: new EventBusService(emitter, logger, prisma, env), prisma };
  }
  const event = { eventName: 'order.updated', aggregate: 'Order', aggregateId: 'o1', occurredAt: new Date(), payload: { v: 1 } };

  it('uses ON CONFLICT merge ($executeRaw) when a dedupeKey is supplied', async () => {
    const { bus, prisma } = make(true);
    await bus.publish(event, { dedupeKey: 'order-status:o1' });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('uses a plain insert when no dedupeKey is supplied', async () => {
    const { bus, prisma } = make(true);
    await bus.publish(event);
    expect(prisma.outboxEvent.create).toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('#1/#5/#7 publisher claim predicate', () => {
  it('gates on RETRYING + debounce_until + scheduled_at', async () => {
    let captured = '';
    const prisma: any = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        captured = strings.join(' ');
        return Promise.resolve([]);
      }),
    };
    const svc = new OutboxPublisherService(prisma, {} as any, envMock({ OUTBOX_BATCH_SIZE: 100 }), {} as any, {} as any);
    await (svc as any).claimBatch();
    expect(captured).toContain("state IN ('PENDING', 'RETRYING')");
    expect(captured).toContain('debounce_until');
    expect(captured).toContain('scheduled_at');
  });
});

describe('#7/#10/#12 publisher markFailed', () => {
  function make(redisIncr: number) {
    const client = { incr: jest.fn().mockResolvedValue(redisIncr), expire: jest.fn(), del: jest.fn() };
    const redis: any = { getClient: () => client };
    const emitter: any = { emit: jest.fn() };
    const prisma: any = {
      outboxEvent: { update: jest.fn().mockResolvedValue({}), delete: jest.fn() },
      outboxDeadLetter: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const env = envMock({ OUTBOX_MAX_ATTEMPTS: 10, OUTBOX_FAILURE_ALERT_THRESHOLD: 25 });
    const svc = new OutboxPublisherService(prisma, redis, env, emitter, {} as any);
    return { svc, prisma, emitter, client };
  }
  const row = (attempts: number) => ({ id: 'r1', eventName: 'e.x', aggregate: 'A', aggregateId: '1', payload: {}, attempts } as any);

  it('flips to RETRYING + persists a 10k error (not 1k) under max attempts', async () => {
    const { svc, prisma } = make(1);
    const longErr = 'E'.repeat(20_000);
    await (svc as any).markFailed(row(0), longErr);
    const data = prisma.outboxEvent.update.mock.calls[0][0].data;
    expect(data.state).toBe('RETRYING');
    expect(data.lastError.length).toBe(10_000);
    expect(prisma.outboxEvent.delete).not.toHaveBeenCalled();
  });

  it('DLQs atomically at max attempts', async () => {
    const { svc, prisma } = make(1);
    await (svc as any).markFailed(row(9), 'boom');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
  });

  it('emits a sev-95 alert exactly when the failure streak hits the threshold (#12)', async () => {
    const { svc, emitter } = make(25);
    await (svc as any).markFailed(row(0), 'outage');
    expect(emitter.emit).toHaveBeenCalledWith(
      'outbox.publisher.failing',
      expect.objectContaining({ consecutiveFailures: 25, severity: 95 }),
    );
  });

  it('does not alert below the threshold', async () => {
    const { svc, emitter } = make(24);
    await (svc as any).markFailed(row(0), 'blip');
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('#8 OutboxDlqService', () => {
  function txMock(dl: any) {
    const tx = {
      outboxDeadLetter: {
        findUnique: jest.fn().mockResolvedValue(dl),
        delete: jest.fn().mockResolvedValue({}),
      },
      outboxEvent: { create: jest.fn().mockResolvedValue({ id: 'new-evt' }) },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    return { svc: new OutboxDlqService(prisma), tx };
  }

  it('replays a dead-letter into a fresh PENDING row + deletes it', async () => {
    const { svc, tx } = txMock({ id: 'dl1', eventName: 'e.x', aggregate: 'A', aggregateId: '1', payload: {} });
    const newId = await svc.replay('dl1');
    expect(newId).toBe('new-evt');
    expect(tx.outboxEvent.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ state: 'PENDING', attempts: 0, eventName: 'e.x' }),
    );
    expect(tx.outboxDeadLetter.delete).toHaveBeenCalledWith({ where: { id: 'dl1' } });
  });

  it('returns null when the dead-letter is gone', async () => {
    const { svc, tx } = txMock(null);
    expect(await svc.replay('missing')).toBeNull();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('#4 OutboxRetentionCron', () => {
  it('purges PUBLISHED rows past the window + aged dead-letters', async () => {
    const prisma: any = {
      outboxEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      outboxDeadLetter: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const env = envMock({ OUTBOX_ENABLED: true, OUTBOX_RETENTION_DAYS: 30, OUTBOX_DLQ_RETENTION_DAYS: 90 });
    const leader: any = { run: (_n: string, _t: number, fn: any) => fn() };
    const instr: any = { wrap: (_n: string, fn: any) => fn() };
    const cron = new OutboxRetentionCron(prisma, env, leader, instr);
    await cron.sweep();
    const where = prisma.outboxEvent.deleteMany.mock.calls[0][0].where;
    expect(where.state).toBe('PUBLISHED');
    expect(where.publishedAt.lt).toBeInstanceOf(Date);
    expect(prisma.outboxDeadLetter.deleteMany).toHaveBeenCalled();
  });

  it('no-ops when the outbox is disabled', async () => {
    const prisma: any = { outboxEvent: { deleteMany: jest.fn() }, outboxDeadLetter: { deleteMany: jest.fn() } };
    const cron = new OutboxRetentionCron(prisma, envMock({ OUTBOX_ENABLED: false }), {} as any, {} as any);
    await cron.sweep();
    expect(prisma.outboxEvent.deleteMany).not.toHaveBeenCalled();
  });
});

describe('#8/#14 AdminOutboxController.replay', () => {
  it('audits + returns the new event id', async () => {
    const dlq: any = { replay: jest.fn().mockResolvedValue('new-evt') };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const ctrl = new AdminOutboxController(dlq, audit);
    const res = await ctrl.replay({ adminId: 'a1' }, 'dl1');
    expect(res.data.outboxEventId).toBe('new-evt');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'outbox.dead_letter.replayed', actorId: 'a1' }),
    );
  });

  it('404s a missing dead-letter', async () => {
    const dlq: any = { replay: jest.fn().mockResolvedValue(null) };
    const audit: any = { writeAuditLog: jest.fn() };
    const ctrl = new AdminOutboxController(dlq, audit);
    await expect(ctrl.replay({ adminId: 'a1' }, 'missing')).rejects.toThrow();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });
});
