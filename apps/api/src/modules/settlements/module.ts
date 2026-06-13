import { Module, forwardRef } from '@nestjs/common';
import { SettlementsPublicFacade } from './application/facades/settlements-public.facade';
import { SettlementService } from './settlement.service';
import { SettlementChargeRuleService } from './settlement-charge-rule.service';
import { AdminSettlementController } from './admin-settlement.controller';
import { AdminSettlementChargeRuleController } from './admin-settlement-charge-rule.controller';
import { SellerEarningsController } from './seller-earnings.controller';
import { AdminAuthGuard, SellerAuthGuard } from '../../core/guards';
import { MoneyModule } from '../../core/money/money.module';
import { TaxModule } from '../tax/module';

@Module({
  // Phase 17 GST — TaxModule provides SettlementTcsHookService which
  // SettlementService uses on approve / mark-paid to keep the TCS
  // ledger in sync. TaxModule also imports SettlementsModule (for
  // GSTR-8 reporting), so the relationship is circular — forwardRef
  // breaks the bootstrap-time chicken-and-egg.
  imports: [MoneyModule, forwardRef(() => TaxModule)],
  controllers: [
    AdminSettlementController,
    AdminSettlementChargeRuleController,
    SellerEarningsController,
  ],
  providers: [
    SettlementsPublicFacade,
    SettlementService,
    SettlementChargeRuleService,
    AdminAuthGuard,
    SellerAuthGuard,
  ],
  // Phase 146 — export SettlementService so the accounts batch-mark-paid path
  // can DELEGATE to the single hardened markSettlementPaid (audit + TCS/TDS +
  // version-CAS + UTR-unique + paise) instead of re-implementing it.
  exports: [SettlementsPublicFacade, SettlementService],
})
export class SettlementsModule {}
