import { Module } from '@nestjs/common';
import { InventoryPublicFacade } from './application/facades/inventory-public.facade';
import { InventoryManagementService } from './application/services/inventory-management.service';
import { SellerInventoryController } from './presentation/controllers/seller-inventory.controller';
import { AdminInventoryController } from './presentation/controllers/admin-inventory.controller';
import { PrismaInventoryManagementRepository } from './infrastructure/repositories/prisma-inventory-management.repository';
import { INVENTORY_MANAGEMENT_REPOSITORY } from './domain/repositories/inventory-management.repository.interface';

// Guards
import { SellerAuthGuard, AdminAuthGuard } from '../../core/guards';

@Module({
  controllers: [
    SellerInventoryController,
    AdminInventoryController,
  ],
  providers: [
    InventoryPublicFacade,
    InventoryManagementService,
    SellerAuthGuard,
    AdminAuthGuard,
    {
      provide: INVENTORY_MANAGEMENT_REPOSITORY,
      useClass: PrismaInventoryManagementRepository,
    },
  ],
  exports: [InventoryPublicFacade],
})
export class InventoryModule {}
