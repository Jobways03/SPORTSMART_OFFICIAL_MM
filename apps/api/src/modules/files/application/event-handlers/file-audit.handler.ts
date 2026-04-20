import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class FileAuditHandler {
  private readonly logger = new Logger(FileAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('files.file.uploaded')
  async handleFileUploaded(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('files.file.deleted')
  async handleFileDeleted(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  private async logEvent(event: DomainEvent): Promise<void> {
    try {
      await this.prisma.eventLog.create({
        data: {
          eventName: event.eventName,
          aggregate: event.aggregate,
          aggregateId: event.aggregateId,
          payload: event.payload as any,
          publishedAt: event.occurredAt,
        },
      });

      this.logger.log(`File audit logged: ${event.eventName}`);
    } catch (error) {
      this.logger.error(`File audit logging failed: ${(error as Error).message}`);
    }
  }
}
