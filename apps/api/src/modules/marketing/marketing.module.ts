import { Module } from '@nestjs/common';
import { AdminAuthGuard, PermissionsGuard } from '../../core/guards';
import { MarketingService } from './marketing.service';
import { PublicFlashSalesController } from './public-flash-sales.controller';
import { PublicEventsController } from './public-events.controller';
import { AdminFlashSalesController } from './admin-flash-sales.controller';
import { AdminEventsController } from './admin-events.controller';

@Module({
  controllers: [
    PublicFlashSalesController,
    PublicEventsController,
    AdminFlashSalesController,
    AdminEventsController,
  ],
  providers: [MarketingService, AdminAuthGuard, PermissionsGuard],
  exports: [MarketingService],
})
export class MarketingModule {}
