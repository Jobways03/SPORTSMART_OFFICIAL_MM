export interface AuditLogRepositoryPort {
  save(entry: {
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
  }): Promise<void>;
  findByFilters(filters: {
    module?: string;
    resource?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]>;
}

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');
