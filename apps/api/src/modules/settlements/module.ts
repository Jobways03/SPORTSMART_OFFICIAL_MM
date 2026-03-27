import { Module } from '@nestjs/common';
import { SettlementsPublicFacade } from './application/facades/settlements-public.facade';
import { SettlementService } from './settlement.service';
import { AdminSettlementController } from './admin-settlement.controller';
import { SellerEarningsController } from './seller-earnings.controller';
import { AdminAuthGuard } from '../admin/infrastructure/guards/admin-auth.guard';
import { SellerAuthGuard } from '../seller/infrastructure/guards/seller-auth.guard';

@Module({
  controllers: [AdminSettlementController, SellerEarningsController],
  providers: [
    SettlementsPublicFacade,
    SettlementService,
    AdminAuthGuard,
    SellerAuthGuard,
  ],
  exports: [SettlementsPublicFacade, SettlementService],
})
export class SettlementsModule {}
