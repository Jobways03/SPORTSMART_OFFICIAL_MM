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
   * Listener fan-out is scheduled on the next tick and NOT awaited here,
   * so slow side-effects (email via SMTP, outbound webhooks) cannot
   * stretch the publisher's HTTP response time. The publisher's business
   * flow has already committed by the time we reach this method; a
   * failing listener does not propagate back to the caller either way.
   *
   * We still attach a single `.catch` so async listener rejections are
   * surfaced in our logs instead of becoming silent unhandled rejections.
   *
   * Durable delivery would require a transactional outbox + background
   * worker — out of scope for this in-process bus.
   */
  async publish(event: DomainEvent): Promise<void> {
    this.logger.log(
      `Publishing ${event.eventName} for ${event.aggregate}:${event.aggregateId}`,
    );
    queueMicrotask(() => {
      this.eventEmitter
        .emitAsync(event.eventName, event)
        .catch((err) => {
          this.logger.error(
            `Listener failed for ${event.eventName} (${event.aggregate}:${event.aggregateId}): ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          );
        });
    });
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
