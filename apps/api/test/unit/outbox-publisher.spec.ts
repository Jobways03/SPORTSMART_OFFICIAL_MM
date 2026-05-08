import 'reflect-metadata';
import { OutboxPublisherService } from '../../src/bootstrap/events/outbox/outbox-publisher.service';

/**
 * Unit tests for OutboxPublisherService (PR 2.2).
 *
 * Covers:
 *   - Tick is a no-op when OUTBOX_ENABLED is false (no DB / Redis calls).
 *   - Tick acquires the Redis lock before claiming.
 *   - Successful publish: row → state PUBLISHED, publishedAt set.
 *   - Failure: row → attempts++, lastError, nextAttemptAt advanced with backoff.
 *   - Max-attempts: row moved to outbox_dead_letters (delete + insert in one tx).
 *   - eventId is exposed on payload for handler-side dedup.
 *   - Per-event errors don't poison the rest of the batch.
 *   - Lock is always released, even on listener error.
 */
describe('OutboxPublisherService', () => {
  let prisma: {
    outboxEvent: {
      update: jest.Mock;
      delete: jest.Mock;
    };
    outboxDeadLetter: { create: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let redis: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  let env: { getBoolean: jest.Mock; getNumber: jest.Mock };
  let emitter: { emitAsync: jest.Mock };
  let service: OutboxPublisherService;

  beforeEach(() => {
    prisma = {
      outboxEvent: {
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      outboxDeadLetter: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn(),
      $transaction: jest.fn().mockImplementation(async (ops) => {
        // Mimic Prisma's array-form $transaction: just runs ops sequentially.
        if (Array.isArray(ops)) {
          for (const _op of ops) {
            // ops are just resolved promises produced by the chain calls;
            // they've already executed against the mocks at this point.
          }
        } else if (typeof ops === 'function') {
          return ops(prisma);
        }
      }),
    };
    redis = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    env = {
      getBoolean: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'OUTBOX_ENABLED' ? true : false,
        ),
      getNumber: jest.fn().mockImplementation((key: string) => {
        if (key === 'OUTBOX_BATCH_SIZE') return 100;
        if (key === 'OUTBOX_POLL_INTERVAL_MS') return 1000;
        if (key === 'OUTBOX_MAX_ATTEMPTS') return 10;
        return 0;
      }),
    };
    emitter = { emitAsync: jest.fn().mockResolvedValue(undefined) };

    service = new OutboxPublisherService(
      prisma as never,
      redis as never,
      env as never,
      emitter as never,
    );
  });

  function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'ev-1',
      eventName: 'returns.return.requested',
      aggregate: 'Return',
      aggregateId: 'ret-1',
      payload: { returnId: 'ret-1' },
      occurredAt: new Date('2026-05-05T00:00:00Z'),
      state: 'PENDING',
      publishedAt: null,
      attempts: 0,
      lastError: null,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    };
  }

  // ─── flag-OFF ─────────────────────────────────────────────────────

  it('no-ops when OUTBOX_ENABLED is false', async () => {
    env.getBoolean.mockReturnValue(false);
    await service.tick();
    expect(redis.acquireLock).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('skips the tick if the Redis lock is unavailable', async () => {
    redis.acquireLock.mockResolvedValue(false);
    await service.tick();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    // Lock not held, don't try to release it.
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  // ─── happy path ───────────────────────────────────────────────────

  it('emits a single event and marks it PUBLISHED', async () => {
    prisma.$queryRaw.mockResolvedValue([buildRow()]);
    await service.tick();
    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(emitter.emitAsync).toHaveBeenCalledWith(
      'returns.return.requested',
      expect.objectContaining({
        eventName: 'returns.return.requested',
        aggregate: 'Return',
        aggregateId: 'ret-1',
      }),
    );
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'ev-1' },
      data: { state: 'PUBLISHED', publishedAt: expect.any(Date) },
    });
    expect(redis.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('attaches eventId to the payload so handlers can dedupe on it', async () => {
    prisma.$queryRaw.mockResolvedValue([buildRow()]);
    await service.tick();
    const passedEvent = emitter.emitAsync.mock.calls[0][1];
    expect(passedEvent.payload.eventId).toBe('ev-1');
  });

  it('does not overwrite an existing eventId on the payload', async () => {
    prisma.$queryRaw.mockResolvedValue([
      buildRow({ payload: { returnId: 'ret-1', eventId: 'pre-existing' } }),
    ]);
    await service.tick();
    const passedEvent = emitter.emitAsync.mock.calls[0][1];
    expect(passedEvent.payload.eventId).toBe('pre-existing');
  });

  // ─── failure path ─────────────────────────────────────────────────

  it('marks an event as failed and schedules a backoff retry', async () => {
    prisma.$queryRaw.mockResolvedValue([buildRow({ attempts: 0 })]);
    emitter.emitAsync.mockRejectedValue(new Error('listener boom'));
    await service.tick();
    expect(prisma.outboxDeadLetter.create).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'ev-1' },
      data: expect.objectContaining({
        attempts: 1,
        lastError: expect.stringContaining('listener boom'),
        nextAttemptAt: expect.any(Date),
      }),
    });
  });

  it('routes to outbox_dead_letters at max attempts', async () => {
    prisma.$queryRaw.mockResolvedValue([buildRow({ attempts: 9 })]);
    emitter.emitAsync.mockRejectedValue(new Error('terminal failure'));
    await service.tick();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The mocked $transaction takes an array of pending ops; the
    // important assertion is that the DLQ row was created and the
    // outbox row was deleted (both as part of that call).
    expect(prisma.outboxDeadLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outboxEventId: 'ev-1',
          eventName: 'returns.return.requested',
          attempts: 10,
          failureReason: expect.stringContaining('terminal failure'),
        }),
      }),
    );
    expect(prisma.outboxEvent.delete).toHaveBeenCalledWith({
      where: { id: 'ev-1' },
    });
  });

  it('isolates a single failure so the rest of the batch still publishes', async () => {
    prisma.$queryRaw.mockResolvedValue([
      buildRow({ id: 'ev-1' }),
      buildRow({ id: 'ev-2', eventName: 'returns.return.approved' }),
      buildRow({ id: 'ev-3', eventName: 'returns.refund.completed' }),
    ]);
    emitter.emitAsync.mockImplementation(async (eventName: string) => {
      if (eventName === 'returns.return.approved') throw new Error('boom');
    });
    await service.tick();
    // Two PUBLISHED + one failure-update = 3 update calls total.
    const updateCalls = prisma.outboxEvent.update.mock.calls;
    expect(updateCalls.length).toBe(3);
    expect(
      updateCalls.find((c) => c[0].data.state === 'PUBLISHED' && c[0].where.id === 'ev-1'),
    ).toBeDefined();
    expect(
      updateCalls.find((c) => c[0].data.state === 'PUBLISHED' && c[0].where.id === 'ev-3'),
    ).toBeDefined();
    expect(
      updateCalls.find((c) => c[0].where.id === 'ev-2' && 'attempts' in c[0].data),
    ).toBeDefined();
  });

  // ─── lock cleanup ─────────────────────────────────────────────────

  it('releases the lock even if everything fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    await expect(service.tick()).rejects.toThrow('db down');
    expect(redis.releaseLock).toHaveBeenCalledTimes(1);
  });
});
