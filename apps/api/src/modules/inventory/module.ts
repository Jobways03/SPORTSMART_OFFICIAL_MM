import { Module } from '@nestjs/common';
import { InventoryPublicFacade } from './application/facades/inventory-public.facade';
import { InventoryManagementService } from './application/services/inventory-management.service';
import { LowStockAlertService } from './application/services/low-stock-alert.service';
import { SellerInventoryController } from './presentation/controllers/seller-inventory.controller';
import { AdminInventoryController } from './presentation/controllers/admin-inventory.controller';
import { AdminLowStockAlertsController } from './presentation/controllers/admin-low-stock-alerts.controller';
import { PrismaInventoryManagementRepository } from './infrastructure/repositories/prisma-inventory-management.repository';
import { INVENTORY_MANAGEMENT_REPOSITORY } from './domain/repositories/inventory-management.repository.interface';
import { FranchiseModule } from '../franchise/module';

// Guards
import { SellerAuthGuard, AdminAuthGuard } from '../../core/guards';

@Module({
  // FranchiseModule exports FranchisePublicFacade, which the admin
  // inventory service uses to merge franchise stock into the unified
  // overview / low-stock / out-of-stock queries.
  imports: [FranchiseModule],
  controllers: [
    SellerInventoryController,
    AdminInventoryController,
    AdminLowStockAlertsController,
  ],
  providers: [
    InventoryPublicFacade,
    InventoryManagementService,
    LowStockAlertService,
    SellerAuthGuard,
    AdminAuthGuard,
    {
      provide: INVENTORY_MANAGEMENT_REPOSITORY,
      useClass: PrismaInventoryManagementRepository,
    },
  ],
  exports: [InventoryPublicFacade, LowStockAlertService],
})
export class InventoryModule {}
