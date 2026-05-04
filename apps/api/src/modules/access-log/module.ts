import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { NotificationsModule } from '../notifications/module';
import { AccessLogService } from './application/services/access-log.service';
import { CustomerAccessHistoryController } from './presentation/controllers/customer-access-history.controller';
import { AdminAccessLogController } from './presentation/controllers/admin-access-log.controller';

// Global so any auth controller can inject AccessLogService without
// adding AccessLogModule to its module imports list.
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [CustomerAccessHistoryController, AdminAccessLogController],
  providers: [AdminAuthGuard, UserAuthGuard, AccessLogService],
  exports: [AccessLogService],
})
export class AccessLogModule {}
