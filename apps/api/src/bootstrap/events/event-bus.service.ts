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

  async publish(event: DomainEvent): Promise<void> {
    this.logger.log(
      `Publishing ${event.eventName} for ${event.aggregate}:${event.aggregateId}`,
    );
    this.eventEmitter.emit(event.eventName, event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
