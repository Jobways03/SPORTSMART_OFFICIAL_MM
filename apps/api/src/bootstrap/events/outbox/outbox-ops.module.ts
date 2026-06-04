import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../../core/guards';
import { AuditModule } from '../../../modules/audit/module';
import { AdminOutboxController } from './admin-outbox.controller';
import { OutboxDlqService } from './outbox-dlq.service';
import { OutboxRetentionCron } from './outbox-retention.cron';

/**
 * Phase 186 — outbox operations surface, kept out of the @Global EventsModule
 * so the admin/auth/audit dependencies don't widen the global graph.
 *
 *   - AdminOutboxController + OutboxDlqService (#8 DLQ replay)
 *   - OutboxRetentionCron (#4 retention sweeper)
 *
 * PermissionsGuard is global (GuardsModule); AdminAuthGuard holds the admin
 * JWT secret lookup so it's provided per-module. LeaderElectedCron +
 * CronInstrumentationService are global, so the cron just injects them.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminOutboxController],
  providers: [OutboxDlqService, OutboxRetentionCron, AdminAuthGuard],
})
export class OutboxOpsModule {}
