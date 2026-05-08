import 'reflect-metadata';
import { EventBusService } from '../../src/bootstrap/events/event-bus.service';
import type { DomainEvent } from '../../src/bootstrap/events/domain-event.interface';

/**
 * Tests for the Phase 2.4 EventBusService outbox-aware publish.
 *
 * Behaviour matrix:
 *   dual-write   authoritative   tx        → outbox write  | direct emit
 *   ────────     ─────────       ───       ──────────────  | ───────────
 *   off          off             —         no              | yes  (legacy)
 *   on           off             undef     yes (global)    | yes  (soak window)
 *   on           off             provided  yes (in tx)     | yes  (soak)
 *   on           on              provided  yes (in tx)     | no   (worker only)
 */
describe('EventBusService — outbox dual-write', () => {
  function buildBus(opts: {
    dualWrite?: boolean;
    authoritative?: boolean;
  }) {
    const emitter = { emitAsync: jest.fn().mockResolvedValue(undefined) };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const env = {
      getBoolean: jest.fn().mockImplementation((key: string) => {
        if (key === 'OUTBOX_DUAL_WRITE') return opts.dualWrite ?? false;
        if (key === 'OUTBOX_AUTHORITATIVE') return opts.authoritative ?? false;
        return false;
      }),
    };
    const prisma = {
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const bus = new EventBusService(
      emitter as never,
      logger as never,
      prisma as never,
      env as never,
    );
    return { bus, emitter, prisma, logger };
  }

  function buildEvent(): DomainEvent {
    return {
      eventName: 'disputes.decided',
      aggregate: 'Dispute',
      aggregateId: 'd-1',
      occurredAt: new Date('2026-05-05T00:00:00Z'),
      payload: { disputeId: 'd-1' },
    };
  }

  it('legacy mode: no outbox write, direct emit fires', async () => {
    const { bus, emitter, prisma } = buildBus({});
    await bus.publish(buildEvent());
    // queueMicrotask defers the emit — wait one tick.
    await new Promise((r) => setImmediate(r));
    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('dual-write without tx: writes outbox via global prisma + still emits', async () => {
    const { bus, emitter, prisma } = buildBus({ dualWrite: true });
    await bus.publish(buildEvent());
    await new Promise((r) => setImmediate(r));
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventName: 'disputes.decided',
        aggregate: 'Dispute',
        aggregateId: 'd-1',
      }),
    });
    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
  });

  it('dual-write with tx: writes outbox via the supplied tx', async () => {
    const { bus, prisma } = buildBus({ dualWrite: true });
    const txCreate = jest.fn().mockResolvedValue({});
    const tx = { outboxEvent: { create: txCreate } };
    await bus.publish(buildEvent(), { tx: tx as never });
    expect(txCreate).toHaveBeenCalledTimes(1);
    // Global prisma must NOT be used when a tx is supplied — otherwise
    // the outbox row escapes the caller's transactional scope.
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('authoritative mode: outbox write only, NO direct emit', async () => {
    const { bus, emitter, prisma } = buildBus({
      dualWrite: true,
      authoritative: true,
    });
    await bus.publish(buildEvent());
    await new Promise((r) => setImmediate(r));
    expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(emitter.emitAsync).not.toHaveBeenCalled();
  });

  it('outbox write failure inside a caller tx PROPAGATES (rollback)', async () => {
    const { bus } = buildBus({ dualWrite: true });
    const txCreate = jest.fn().mockRejectedValue(new Error('disk full'));
    const tx = { outboxEvent: { create: txCreate } };
    await expect(
      bus.publish(buildEvent(), { tx: tx as never }),
    ).rejects.toThrow('disk full');
  });

  it('outbox write failure WITHOUT tx is logged and swallowed; direct emit still runs', async () => {
    const { bus, emitter, prisma, logger } = buildBus({ dualWrite: true });
    prisma.outboxEvent.create.mockRejectedValue(new Error('disk full'));
    await expect(bus.publish(buildEvent())).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Outbox write failed'),
    );
    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
  });
});
