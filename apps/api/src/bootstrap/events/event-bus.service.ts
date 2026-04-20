import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppLoggerService } from '../logging/app-logger.service';
import { DomainEvent } from './domain-event.interface';

@Injectable()
export class EventBusService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('EventBus');
  }

  /**
   * Publish a domain event to all registered listeners.
   *
   * Uses `emitAsync` so any async listener error is captured and logged
   * here — `emit()` would fire-and-forget and turn a failing listener
   * into an unhandled promise rejection (invisible in the publisher's
   * logs, potentially crashing Node under --unhandled-rejections=strict).
   *
   * The publisher's business flow has already committed by the time
   * this runs; a failing listener does not propagate back to the caller.
   * Durable delivery would require a transactional outbox + background
   * worker — out of scope for this in-process bus.
   */
  async publish(event: DomainEvent): Promise<void> {
    this.logger.log(
      `Publishing ${event.eventName} for ${event.aggregate}:${event.aggregateId}`,
    );
    try {
      await this.eventEmitter.emitAsync(event.eventName, event);
    } catch (err) {
      this.logger.error(
        `Listener failed for ${event.eventName} (${event.aggregate}:${event.aggregateId}): ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
      // Deliberately do NOT rethrow — best-effort delivery.
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
