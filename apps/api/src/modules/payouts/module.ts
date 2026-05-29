import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { PayoutService } from './payout.service';
import { BankResponseParserService } from './bank-response-parser.service';
import { AdminPayoutController } from './admin-payout.controller';
import { MoneyModule } from '../../core/money/money.module';
// Phase 151 — TaxModule provides the TCS / 194-O TDS hooks (so batch ingest
// mirrors markSettlementPaid's compliance side-effects); SellerModule provides
// SellerBankDetailsService (decrypt the beneficiary account for the bank file).
// AuditPublicFacade + EventBusService are @Global (no import needed).
import { TaxModule } from '../tax/module';
import { SellerModule } from '../seller/module';

@Module({
  imports: [MoneyModule, TaxModule, SellerModule],
  controllers: [AdminPayoutController],
  providers: [AdminAuthGuard, PayoutService, BankResponseParserService],
  exports: [PayoutService],
})
export class PayoutsModule {}
