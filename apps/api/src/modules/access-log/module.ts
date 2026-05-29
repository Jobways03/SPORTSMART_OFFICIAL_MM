import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { NotificationsModule } from '../notifications/module';
import { AccessLogService } from './application/services/access-log.service';
import { AdminActivityService } from './application/services/admin-activity.service';
import { AdminSessionsService } from './application/services/admin-sessions.service';
import { OldRevokedSessionsSweepCron } from './application/jobs/old-revoked-sessions-sweep.cron';
import { CustomerAccessHistoryController } from './presentation/controllers/customer-access-history.controller';
import { AdminAccessLogController } from './presentation/controllers/admin-access-log.controller';
import { AdminActivityController } from './presentation/controllers/admin-activity.controller';
import { AdminSessionsController } from './presentation/controllers/admin-sessions.controller';

// Global so any auth controller can inject AccessLogService without
// adding AccessLogModule to its module imports list.
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [
    CustomerAccessHistoryController,
    AdminAccessLogController,
    AdminActivityController,
    AdminSessionsController,
  ],
  providers: [
    AdminAuthGuard,
    UserAuthGuard,
    AccessLogService,
    AdminActivityService,
    AdminSessionsService,
    // Phase 27 (2026-05-21) — daily sweep of old revoked session rows
    // (90-day retention). Read-only on active sessions; safe to default
    // on. See cron file for full rationale.
    OldRevokedSessionsSweepCron,
  ],
  exports: [AccessLogService, AdminSessionsService],
})
export class AccessLogModule {}
