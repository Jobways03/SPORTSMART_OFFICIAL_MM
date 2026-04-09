import { Module } from '@nestjs/common';
import { SettlementsPublicFacade } from './application/facades/settlements-public.facade';
import { SettlementService } from './settlement.service';
import { AdminSettlementController } from './admin-settlement.controller';
import { SellerEarningsController } from './seller-earnings.controller';
import { AdminAuthGuard, SellerAuthGuard } from '../../core/guards';

@Module({
  controllers: [AdminSettlementController, SellerEarningsController],
  providers: [
    SettlementsPublicFacade,
    SettlementService,
    AdminAuthGuard,
    SellerAuthGuard,
  ],
  exports: [SettlementsPublicFacade],
})
export class SettlementsModule {}
