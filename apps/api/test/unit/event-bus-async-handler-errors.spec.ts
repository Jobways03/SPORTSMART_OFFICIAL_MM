import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventBusService } from '../../src/bootstrap/events/event-bus.service';

/**
 * Regression test for the event bus swallowing async listener errors.
 *
 * Before: EventBusService.publish called `eventEmitter.emit(...)` which
 * is synchronous and does not await async listeners. Any listener that
 * threw or rejected became an unhandled promise rejection — invisible
 * in the publisher's logs and potentially crash-exiting Node under
 * `--unhandled-rejections=strict`.
 *
 * After: publish uses `emitAsync`, awaits the dispatch, and catches
 * listener errors in the bus so they're logged with the event context
 * instead of escaping into the process.
 */

describe('EventBusService — async listener error capture', () => {
  const buildBus = () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    const bus = new EventBusService(emitter, logger);
    return { bus, emitter, logger };
  };

  const baseEvent = {
    eventName: 'test.event',
    aggregate: 'Test',
    aggregateId: 'id-1',
    occurredAt: new Date(),
    payload: {},
  };

  it('resolves cleanly when no listeners are registered', async () => {
    const { bus } = buildBus();
    await expect(bus.publish(baseEvent)).resolves.toBeUndefined();
  });

  it('resolves cleanly when a listener succeeds', async () => {
    const { bus, emitter } = buildBus();
    const handler = jest.fn().mockResolvedValue(undefined);
    emitter.on('test.event', handler);

    await bus.publish(baseEvent);
    expect(handler).toHaveBeenCalled();
  });

  it('captures async listener errors instead of rethrowing', async () => {
    const { bus, emitter, logger } = buildBus();
    emitter.on('test.event', async () => {
      throw new Error('listener boom');
    });

    // The publisher MUST NOT reject — this is the regression.
    await expect(bus.publish(baseEvent)).resolves.toBeUndefined();

    // The error should have been logged with enough context to trace.
    expect(logger.error).toHaveBeenCalled();
    const message = logger.error.mock.calls[0][0];
    expect(message).toContain('test.event');
    expect(message).toContain('listener boom');
  });

  it('still dispatches to other listeners when one throws', async () => {
    const { bus, emitter } = buildBus();
    const healthy = jest.fn().mockResolvedValue(undefined);
    emitter.on('test.event', async () => {
      throw new Error('first handler boom');
    });
    emitter.on('test.event', healthy);

    await bus.publish(baseEvent);
    // EventEmitter2 invokes listeners in registration order; the second
    // one must run even though the first threw.
    expect(healthy).toHaveBeenCalled();
  });
});
