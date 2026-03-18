export class AuditLogEntity { id: string; actorId: string; action: string; resource: string; resourceId: string; metadata: Record<string, unknown>; createdAt: Date; }
