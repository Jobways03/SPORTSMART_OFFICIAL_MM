import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { EventDeduplicationService } from '../../src/bootstrap/events/outbox/event-deduplication.service';
import { IdempotentHandler } from '../../src/bootstrap/events/outbox/idempotent-handler.decorator';
import type { DomainEvent } from '../../src/bootstrap/events/domain-event.interface';

/**
 * Tests for the dedup service + the @IdempotentHandler decorator.
 *
 * Key behaviours:
 *   - Flag-OFF: tryConsume always returns true; handlers run.
 *   - First time: INSERT succeeds, returns true.
 *   - Replay (P2002): returns false, handler skips.
 *   - Other DB error: log + return true (fail-open — duplicate is
 *     better than dropped on a transient infra outage).
 *   - Synthetic eventId fallback when payload doesn't include one.
 *   - Decorator runs the original method exactly once on first call,
 *     skips on second.
 */
describe('EventDeduplicationService', () => {
  let prisma: { eventDeduplication: { create: jest.Mock; deleteMany: jest.Mock } };
  let env: { getBoolean: jest.Mock };
  let service: EventDeduplicationService;

  beforeEach(() => {
    prisma = {
      eventDeduplication: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
    };
    env = {
      getBoolean: jest.fn().mockReturnValue(true),
    };
    service = new EventDeduplicationService(prisma as never, env as never);
  });

  function buildEvent(payload: Record<string, unknown> = {}): DomainEvent {
    return {
      eventName: 'disputes.decided',
      aggregate: 'Dispute',
      aggregateId: 'd-1',
      occurredAt: new Date('2026-05-05T00:00:00Z'),
      payload: { eventId: 'ev-42', ...payload } as never,
    };
  }

  it('returns true (proceed) when flag is OFF', async () => {
    env.getBoolean.mockReturnValue(false);
    const result = await service.tryConsume(buildEvent(), 'X.handle');
    expect(result).toBe(true);
    expect(prisma.eventDeduplication.create).not.toHaveBeenCalled();
  });

  it('returns true on first claim (INSERT succeeds)', async () => {
    const result = await service.tryConsume(buildEvent(), 'X.handle');
    expect(result).toBe(true);
    expect(prisma.eventDeduplication.create).toHaveBeenCalledWith({
      data: { eventId: 'ev-42', handler: 'X.handle' },
    });
  });

  it('returns false on duplicate (P2002)', async () => {
    prisma.eventDeduplication.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      } as never),
    );
    const result = await service.tryConsume(buildEvent(), 'X.handle');
    expect(result).toBe(false);
  });

  it('fails open on other DB errors (returns true so handler still runs)', async () => {
    prisma.eventDeduplication.create.mockRejectedValue(new Error('db down'));
    const result = await service.tryConsume(buildEvent(), 'X.handle');
    expect(result).toBe(true);
  });

  it('synthesises an event id when payload has none', async () => {
    const event = buildEvent({ eventId: undefined });
    delete (event.payload as Record<string, unknown>).eventId;
    await service.tryConsume(event, 'X.handle');
    const data = prisma.eventDeduplication.create.mock.calls[0][0].data;
    expect(data.eventId).toMatch(
      /^Dispute:d-1:disputes\.decided:\d+$/,
    );
  });
});

describe('@IdempotentHandler', () => {
  let dedup: { tryConsume: jest.Mock };

  beforeEach(() => {
    dedup = { tryConsume: jest.fn() };
  });

  class TestHandler {
    public consumed: number = 0;
    constructor(public eventDedup: { tryConsume: jest.Mock }) {}

    @IdempotentHandler()
    async onIt(event: DomainEvent): Promise<string> {
      this.consumed += 1;
      return `handled-${event.aggregateId}`;
    }
  }

  function buildEvent(): DomainEvent {
    return {
      eventName: 'test.event',
      aggregate: 'Foo',
      aggregateId: 'foo-1',
      occurredAt: new Date(),
      payload: { eventId: 'ev-1' },
    };
  }

  it('runs the original method on first call', async () => {
    dedup.tryConsume.mockResolvedValue(true);
    const handler = new TestHandler(dedup);
    const out = await handler.onIt(buildEvent());
    expect(out).toBe('handled-foo-1');
    expect(handler.consumed).toBe(1);
    expect(dedup.tryConsume).toHaveBeenCalledWith(
      expect.any(Object),
      'TestHandler.onIt',
    );
  });

  it('skips the original method when tryConsume returns false', async () => {
    dedup.tryConsume.mockResolvedValue(false);
    const handler = new TestHandler(dedup);
    const out = await handler.onIt(buildEvent());
    expect(out).toBeUndefined();
    expect(handler.consumed).toBe(0);
  });

  it('runs through if eventDedup is not attached (test convenience)', async () => {
    const handler = new TestHandler(undefined as never);
    const out = await handler.onIt(buildEvent());
    expect(out).toBe('handled-foo-1');
    expect(handler.consumed).toBe(1);
  });

  it('uses the configured handler-name override', async () => {
    class Renamed {
      constructor(public eventDedup: { tryConsume: jest.Mock }) {}
      @IdempotentHandler({ handler: 'Legacy.name' })
      async onIt(_event: DomainEvent) {
        return 'ok';
      }
    }
    dedup.tryConsume.mockResolvedValue(true);
    const h = new Renamed(dedup);
    await h.onIt(buildEvent());
    expect(dedup.tryConsume).toHaveBeenCalledWith(
      expect.any(Object),
      'Legacy.name',
    );
  });
});
