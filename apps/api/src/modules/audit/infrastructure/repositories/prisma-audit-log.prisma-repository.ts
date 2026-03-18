import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditLogRepositoryPort } from '../../domain/repositories/audit-log.repository';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(entry: Parameters<AuditLogRepositoryPort['save']>[0]): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        action: entry.action,
        module: entry.module,
        resource: entry.resource,
        resourceId: entry.resourceId,
        oldValue: entry.oldValue as any,
        newValue: entry.newValue as any,
        metadata: entry.metadata as any,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }

  async findByFilters(filters: Parameters<AuditLogRepositoryPort['findByFilters']>[0]): Promise<unknown[]> {
    return this.prisma.auditLog.findMany({
      where: {
        ...(filters.module && { module: filters.module }),
        ...(filters.resource && { resource: filters.resource }),
        ...(filters.actorId && { actorId: filters.actorId }),
        ...(filters.from && { createdAt: { gte: filters.from } }),
        ...(filters.to && { createdAt: { lte: filters.to } }),
      },
      take: filters.limit || 50,
      skip: filters.offset || 0,
      orderBy: { createdAt: 'desc' },
    });
  }
}
