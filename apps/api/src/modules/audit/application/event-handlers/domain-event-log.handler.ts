import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaEventLogRepository } from '../../infrastructure/repositories/prisma-event-log.prisma-repository';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

@Injectable()
export class DomainEventLogHandler {
  constructor(
    private readonly eventLogRepo: PrismaEventLogRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('DomainEventLogHandler');
  }

  @OnEvent('**')
  async handleAll(event: DomainEvent): Promise<void> {
    if (!event?.eventName || !event?.aggregate) return;
    try {
      await this.eventLogRepo.save({
        eventName: event.eventName,
        aggregate: event.aggregate,
        aggregateId: event.aggregateId,
        payload: event.payload,
        publishedAt: event.occurredAt,
      });
    } catch (err) {
      this.logger.error(`Failed to persist event ${event.eventName}: ${err}`);
    }
  }
}
