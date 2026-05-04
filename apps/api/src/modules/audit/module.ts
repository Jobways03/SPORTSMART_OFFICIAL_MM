import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { AuditPublicFacade } from './application/facades/audit-public.facade';
import { AuditLogBuilderService } from './application/services/audit-log-builder.service';
import { DomainEventLogHandler } from './application/event-handlers/domain-event-log.handler';
import { PrismaAuditLogRepository } from './infrastructure/repositories/prisma-audit-log.prisma-repository';
import { PrismaEventLogRepository } from './infrastructure/repositories/prisma-event-log.prisma-repository';
import { AdminAuditController } from './presentation/controllers/admin-audit.controller';

@Global()
@Module({
  controllers: [AdminAuditController],
  providers: [
    AdminAuthGuard,
    AuditPublicFacade,
    AuditLogBuilderService,
    DomainEventLogHandler,
    PrismaAuditLogRepository,
    PrismaEventLogRepository,
  ],
  exports: [AuditPublicFacade],
})
export class AuditModule {}
