import { Injectable } from '@nestjs/common';
import { AuditPublicFacade } from '../facades/audit-public.facade';

@Injectable()
export class AuditLogBuilderService {
  constructor(private readonly auditFacade: AuditPublicFacade) {}

  async record(params: {
    actorId?: string;
    actorRole?: string;
    action: string;
    module: string;
    resource: string;
    resourceId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    await this.auditFacade.writeAuditLog(params);
  }
}
