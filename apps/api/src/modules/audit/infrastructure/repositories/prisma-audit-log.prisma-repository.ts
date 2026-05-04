import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditLogRepositoryPort } from '../../domain/repositories/audit-log.repository';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(entry: Parameters<AuditLogRepositoryPort['save']>[0]): Promise<void> {
    // Hash chain: read latest row's hash, fold this row's payload into
    // sha256(prevHash + payload). Lets a verifier walk the chain from
    // a known-good checkpoint and detect any post-hoc edit.
    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.auditLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { hash: true },
      });
      const prevHash = latest?.hash ?? null;

      const payload = JSON.stringify({
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        module: entry.module,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        metadata: entry.metadata ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        ts: new Date().toISOString(),
      });
      const hash = createHash('sha256')
        .update((prevHash ?? '') + '|' + payload)
        .digest('hex');

      await tx.auditLog.create({
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
          prevHash,
          hash,
        },
      });
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
