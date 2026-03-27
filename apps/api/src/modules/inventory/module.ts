import { Module } from '@nestjs/common';
import { InventoryPublicFacade } from './application/facades/inventory-public.facade';
import { InventoryManagementService } from './application/services/inventory-management.service';
import { SellerInventoryController } from './presentation/controllers/seller-inventory.controller';
import { AdminInventoryController } from './presentation/controllers/admin-inventory.controller';

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
  ],
  exports: [InventoryPublicFacade, InventoryManagementService],
})
export class InventoryModule {}
