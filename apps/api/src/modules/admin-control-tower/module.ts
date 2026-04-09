import { Module } from '@nestjs/common';
import { AdminControlTowerPublicFacade } from './application/facades/admin-control-tower-public.facade';
import { AdminDashboardService } from './application/services/admin-dashboard.service';
import { AdminOperationsService } from './application/services/admin-operations.service';
import { DataValidationService } from './application/services/data-validation.service';
import { AdminDashboardController } from './presentation/controllers/admin-dashboard.controller';
import { DataValidationController } from './presentation/controllers/data-validation.controller';
import { PrismaAdminControlTowerRepository } from './infrastructure/repositories/prisma-admin-control-tower.repository';
import { ADMIN_CONTROL_TOWER_REPOSITORY } from './domain/repositories/admin-control-tower.repository.interface';
import { AdminAuthGuard } from '../../core/guards';

@Module({
  controllers: [AdminDashboardController, DataValidationController],
  providers: [
    AdminControlTowerPublicFacade,
    AdminDashboardService,
    AdminOperationsService,
    DataValidationService,
    AdminAuthGuard,
    {
      provide: ADMIN_CONTROL_TOWER_REPOSITORY,
      useClass: PrismaAdminControlTowerRepository,
    },
  ],
  exports: [AdminControlTowerPublicFacade],
})
export class AdminControlTowerModule {}
