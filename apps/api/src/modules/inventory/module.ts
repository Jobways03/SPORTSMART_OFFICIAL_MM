import { Module } from '@nestjs/common';
import { InventoryPublicFacade } from './application/facades/inventory-public.facade';

@Module({
  providers: [InventoryPublicFacade],
  exports: [InventoryPublicFacade],
})
export class InventoryModule {}
