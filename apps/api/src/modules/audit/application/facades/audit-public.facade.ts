import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaAuditLogRepository } from '../../infrastructure/repositories/prisma-audit-log.prisma-repository';
import { PrismaEventLogRepository } from '../../infrastructure/repositories/prisma-event-log.prisma-repository';
import type { AuditLogEntry } from '../../domain/repositories/audit-log.repository';
import {
  canonicalModule,
  isKnownActorType,
  isKnownModule,
} from '../services/audit-event-types';

@Injectable()
export class AuditPublicFacade {
  private readonly logger = new Logger(AuditPublicFacade.name);

  constructor(
    private readonly auditLogRepo: PrismaAuditLogRepository,
    private readonly eventLogRepo: PrismaEventLogRepository,
  ) {}

  /**
   * Write one hash-chained audit row.
   *
   * Phase 203 (#4) — pass `tx` (the caller's Prisma transaction client) to
   * append the audit row atomically with the business change it records.
   * Without it the write runs in its own transaction (legacy best-effort
   * behaviour, kept so the 27 un-threaded callers keep working).
   *
   * Phase 205 (#5) — `actorType` / `module` are validated TOLERANTLY at this
   * boundary: a recognised value passes; an unrecognised one is accepted but
   * logged as drift (so we can drive drift to zero before flipping to strict).
   * The `module` value is normalised through the alias map (`wallets`→`wallet`).
   */
  async writeAuditLog(
    entry: AuditLogEntry,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (entry.actorType && !isKnownActorType(entry.actorType)) {
      this.logger.warn(
        `audit drift: unknown actorType "${entry.actorType}" (action=${entry.action}, module=${entry.module})`,
      );
    }
    if (entry.module && !isKnownModule(entry.module)) {
      this.logger.warn(
        `audit drift: unknown module "${entry.module}" (action=${entry.action})`,
      );
    }
    await this.auditLogRepo.save(
      { ...entry, module: canonicalModule(entry.module) },
      tx,
    );
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

  /**
   * Read AuditLog rows by filter. Used by:
   *   - identity/ConsentService.getHistory (DPDP §11 right-of-access; scoped
   *     to the requesting customer's own actorId);
   *   - discounts admin audit-history panel (gated by discounts.read).
   *
   * Phase 203 (#5) — kept (it HAS gated internal consumers; the audit finding's
   * "zero consumers, remove it" premise is stale). `resourceId` is now a
   * first-class filter so callers no longer over-fetch and filter in memory.
   */
  async searchAuditHistory(filters: {
    module?: string;
    resource?: string;
    resourceId?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]> {
    return this.auditLogRepo.findByFilters(filters);
  }
}
