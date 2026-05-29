import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { AuditPublicFacade } from './application/facades/audit-public.facade';
import { AuditLogBuilderService } from './application/services/audit-log-builder.service';
import { AuditChainAnchorService } from './application/services/audit-chain-anchor.service';
import { AuditChainAnchorCron } from './application/jobs/audit-chain-anchor.cron';
import { DomainEventLogHandler } from './application/event-handlers/domain-event-log.handler';
import { AdminActionAuditHandler } from './application/event-handlers/admin-action-audit.handler';
// Phase 79 (2026-05-22) — history audit Gap #18. Mirrors
// `orders.sub_order.reassigned` events into admin_action_audit_logs
// when reassignedBy is set, so cross-cutting "all admin actions on
// order X" reports include reassignments.
import { OrderReassignmentAuditHandler } from './application/event-handlers/order-reassignment-audit.handler';
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
    AuditChainAnchorService,
    AuditChainAnchorCron,
    DomainEventLogHandler,
    // PR 2 — previously declared but never registered. Listens to
    // `admin.action.**` and writes to admin_action_audit_logs.
    AdminActionAuditHandler,
    // Phase 79 — listens to `orders.sub_order.reassigned`.
    OrderReassignmentAuditHandler,
    PrismaAuditLogRepository,
    PrismaEventLogRepository,
  ],
  exports: [AuditPublicFacade, AuditChainAnchorService],
})
export class AuditModule {}
