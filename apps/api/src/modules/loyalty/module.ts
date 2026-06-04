import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { WalletModule } from '../wallet/module';
import { LoyaltyService } from './application/services/loyalty.service';
import { LoyaltyPaymentCapturedHandler } from './application/event-handlers/loyalty-payment-captured.handler';
import { LoyaltyRefundClawbackHandler } from './application/event-handlers/loyalty-refund-clawback.handler';
import { AdminLoyaltyController } from './presentation/controllers/admin-loyalty.controller';

/**
 * Phase 182 (Customer Wallet audit #2/#3) — the loyalty/cashback pillar. Earns a
 * config-driven LOYALTY_REBATE wallet credit on captured orders (OFF by default).
 */
@Module({
  imports: [WalletModule],
  controllers: [AdminLoyaltyController],
  providers: [LoyaltyService, LoyaltyPaymentCapturedHandler, LoyaltyRefundClawbackHandler, AdminAuthGuard],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
