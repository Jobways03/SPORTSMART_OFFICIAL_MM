import type { Prisma } from '@prisma/client';

export interface AuditLogEntry {
  actorId?: string;
  actorRole?: string;
  /** Phase 205 (#4) — classified principal (enum value as a string). */
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
  /** Phase 203 (#13) — correlation / request id. */
  requestId?: string;
}

export interface AuditLogRepositoryPort {
  /**
   * Phase 203 (#4) — optional `tx` lets a caller append the audit row inside
   * their own business transaction so the audit write commits or rolls back
   * atomically with the change it records.
   */
  save(entry: AuditLogEntry, tx?: Prisma.TransactionClient): Promise<void>;
  findByFilters(filters: {
    module?: string;
    resource?: string;
    resourceId?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]>;
}

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');
