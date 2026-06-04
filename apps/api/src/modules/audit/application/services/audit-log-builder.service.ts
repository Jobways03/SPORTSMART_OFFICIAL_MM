import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditPublicFacade } from '../facades/audit-public.facade';

@Injectable()
export class AuditLogBuilderService {
  constructor(private readonly auditFacade: AuditPublicFacade) {}

  async record(
    params: {
      actorId?: string;
      actorRole?: string;
      actorType?: string;
      action: string;
      module: string;
      resource: string;
      resourceId?: string;
      oldValue?: unknown;
      newValue?: unknown;
      metadata?: unknown;
      ipAddress?: string;
      userAgent?: string;
      requestId?: string;
    },
    // Phase 203 (#4) — thread the caller's transaction so the audit row
    // commits atomically with the change it records.
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.auditFacade.writeAuditLog(params, tx);
  }
}
