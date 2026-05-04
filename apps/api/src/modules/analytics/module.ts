import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { AnalyticsService } from './application/services/analytics.service';
import { AdminAnalyticsController } from './presentation/controllers/admin-analytics.controller';

@Module({
  controllers: [AdminAnalyticsController],
  providers: [AdminAuthGuard, AnalyticsService],
})
export class AnalyticsModule {}
