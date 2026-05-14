import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { NotificationsModule } from '../notifications/module';
import { AccessLogService } from './application/services/access-log.service';
import { AdminActivityService } from './application/services/admin-activity.service';
import { AdminSessionsService } from './application/services/admin-sessions.service';
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
  ],
  exports: [AccessLogService, AdminSessionsService],
})
export class AccessLogModule {}
