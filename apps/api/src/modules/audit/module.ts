import { Global, Module } from '@nestjs/common';
import { AuditPublicFacade } from './application/facades/audit-public.facade';
import { AuditLogBuilderService } from './application/services/audit-log-builder.service';
import { DomainEventLogHandler } from './application/event-handlers/domain-event-log.handler';
import { PrismaAuditLogRepository } from './infrastructure/repositories/prisma-audit-log.prisma-repository';
import { PrismaEventLogRepository } from './infrastructure/repositories/prisma-event-log.prisma-repository';

// Audit is a cross-cutting concern — every module needs to write audit
// records for sensitive operations without each one having to declare
// AuditModule in its imports list. Marking it @Global makes
// AuditPublicFacade injectable anywhere.
@Global()
@Module({
  providers: [
    AuditPublicFacade,
    AuditLogBuilderService,
    DomainEventLogHandler,
    PrismaAuditLogRepository,
    PrismaEventLogRepository,
  ],
  exports: [AuditPublicFacade],
})
export class AuditModule {}
