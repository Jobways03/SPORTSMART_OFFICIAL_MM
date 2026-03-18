import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventLogRepositoryPort } from '../../domain/repositories/event-log.repository';

@Injectable()
export class PrismaEventLogRepository implements EventLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(entry: Parameters<EventLogRepositoryPort['save']>[0]): Promise<void> {
    await this.prisma.eventLog.create({
      data: {
        eventName: entry.eventName,
        aggregate: entry.aggregate,
        aggregateId: entry.aggregateId,
        payload: entry.payload as any,
        publishedAt: entry.publishedAt,
      },
    });
  }

  async findByAggregate(aggregate: string, aggregateId: string): Promise<unknown[]> {
    return this.prisma.eventLog.findMany({
      where: { aggregate, aggregateId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
