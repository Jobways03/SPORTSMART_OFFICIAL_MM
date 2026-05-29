import { forwardRef, Module } from '@nestjs/common';
import { AdminControlTowerPublicFacade } from './application/facades/admin-control-tower-public.facade';
import { AdminDashboardService } from './application/services/admin-dashboard.service';
import { AdminOperationsService } from './application/services/admin-operations.service';
import { DataValidationService } from './application/services/data-validation.service';
import { AdminDashboardController } from './presentation/controllers/admin-dashboard.controller';
import { DataValidationController } from './presentation/controllers/data-validation.controller';
import { PrismaAdminControlTowerRepository } from './infrastructure/repositories/prisma-admin-control-tower.repository';
import { ADMIN_CONTROL_TOWER_REPOSITORY } from './domain/repositories/admin-control-tower.repository.interface';
import { AdminAuthGuard } from '../../core/guards';
// Phase 59 (2026-05-22) — CatalogModule provides CatalogCacheService
// so the bulk suspend/activate flow can invalidate the storefront
// product-list cache the moment a seller's catalog goes offline
// (audit Gap #11). forwardRef keeps the module boot order safe in
// case CatalogModule ever picks up a dependency on this one.
import { CatalogModule } from '../catalog/module';
// Phase 78 (2026-05-22) — reassign Gap #6 unification. The control-tower
// facade routes its `reassign-sub-order` action to the canonical
// OrdersService; forwardRef avoids a boot-order cycle since OrdersModule
// imports AuditModule which imports... eventually back here for some
// shared interceptors.
import { OrdersModule } from '../orders/module';

@Module({
  imports: [forwardRef(() => CatalogModule), forwardRef(() => OrdersModule)],
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
