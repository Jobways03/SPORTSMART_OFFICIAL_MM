import { Injectable } from '@nestjs/common';
import { PrismaAuditLogRepository } from '../../infrastructure/repositories/prisma-audit-log.prisma-repository';
import { PrismaEventLogRepository } from '../../infrastructure/repositories/prisma-event-log.prisma-repository';

@Injectable()
export class AuditPublicFacade {
  constructor(
    private readonly auditLogRepo: PrismaAuditLogRepository,
    private readonly eventLogRepo: PrismaEventLogRepository,
  ) {}

  async writeAuditLog(entry: {
    actorId?: string;
    actorRole?: string;
    action: string;
    module: string;
    resource: string;
    resourceId?: string;
    oldValue?: unknown;
    newValue?: unknown;
    metadata?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.auditLogRepo.save(entry);
  }

  async writeEventLog(entry: {
    eventName: string;
    aggregate: string;
    aggregateId: string;
    payload: unknown;
    publishedAt: Date;
  }): Promise<void> {
    await this.eventLogRepo.save(entry);
  }

  async searchAuditHistory(filters: {
    module?: string;
    resource?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]> {
    return this.auditLogRepo.findByFilters(filters);
  }
}
