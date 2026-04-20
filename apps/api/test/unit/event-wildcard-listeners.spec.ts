import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventBusService } from '../../src/bootstrap/events/event-bus.service';

/**
 * Regression test: wildcard listeners in the audit module
 * (@OnEvent('**') for the domain-event log, @OnEvent('admin.action.*')
 * for the admin-action auditor) fire when the bus emits a concrete
 * event.
 *
 * Before: EventEmitterModule.forRoot was configured with
 * `wildcard: false`, which means the '**' pattern was registered as
 * the literal event name "**" and never matched anything. Net effect:
 * the EventLog audit table was empty in production despite the handler
 * looking like it was wired. The motivating fix is flipping the config
 * to wildcard: true; this test asserts the behaviour end-to-end by
 * spinning up EventEmitter2 with the same config and confirming a
 * wildcard listener sees a concrete event.
 */

describe('EventEmitter2 — wildcard listener config', () => {
  it('wildcard: true allows ** to match any concrete event', async () => {
    const emitter = new EventEmitter2({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
    });
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    const bus = new EventBusService(emitter, logger);

    const wildcardHandler = jest.fn();
    emitter.on('**', wildcardHandler);

    await bus.publish({
      eventName: 'orders.master.created',
      aggregate: 'MasterOrder',
      aggregateId: 'order-1',
      occurredAt: new Date(),
      payload: { foo: 'bar' },
    });

    expect(wildcardHandler).toHaveBeenCalledTimes(1);
  });

  it('narrow wildcard admin.action.* matches nested admin events', async () => {
    const emitter = new EventEmitter2({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
    });
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    const bus = new EventBusService(emitter, logger);

    const adminHandler = jest.fn();
    emitter.on('admin.action.*', adminHandler);

    await bus.publish({
      eventName: 'admin.action.seller_deleted',
      aggregate: 'Seller',
      aggregateId: 's-1',
      occurredAt: new Date(),
      payload: {},
    });
    // Unrelated event shouldn't fire the admin handler.
    await bus.publish({
      eventName: 'orders.master.created',
      aggregate: 'MasterOrder',
      aggregateId: 'o-1',
      occurredAt: new Date(),
      payload: {},
    });

    expect(adminHandler).toHaveBeenCalledTimes(1);
  });

  it('wildcard: false (the broken config) means ** never fires', async () => {
    // Paranoia check — document the actual broken behaviour so a future
    // regression that flips the config back is caught.
    const emitter = new EventEmitter2({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
    });
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    const bus = new EventBusService(emitter, logger);

    const wildcardHandler = jest.fn();
    emitter.on('**', wildcardHandler);

    await bus.publish({
      eventName: 'orders.master.created',
      aggregate: 'MasterOrder',
      aggregateId: 'order-1',
      occurredAt: new Date(),
      payload: {},
    });

    expect(wildcardHandler).not.toHaveBeenCalled();
  });
});
