import { Module } from '@nestjs/common';
import { AdminControlTowerPublicFacade } from './application/facades/admin-control-tower-public.facade';
import { AdminDashboardService } from './application/services/admin-dashboard.service';
import { AdminOperationsService } from './application/services/admin-operations.service';
import { AdminDashboardController } from './presentation/controllers/admin-dashboard.controller';
import { DataValidationController } from './presentation/controllers/data-validation.controller';
import { AdminAuthGuard } from '../../core/guards';

@Module({
  controllers: [AdminDashboardController, DataValidationController],
  providers: [
    AdminControlTowerPublicFacade,
    AdminDashboardService,
    AdminOperationsService,
    AdminAuthGuard,
  ],
  exports: [AdminControlTowerPublicFacade, AdminDashboardService, AdminOperationsService],
})
export class AdminControlTowerModule {}
