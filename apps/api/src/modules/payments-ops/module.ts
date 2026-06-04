import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { PaymentOpsService } from './application/services/payment-ops.service';
import { PaymentOpsFacade } from './application/facades/payment-ops.facade';
import { ChargebackService } from './application/services/chargeback.service';
import { AdminPaymentOpsController } from './presentation/controllers/admin-payment-ops.controller';
// Phase 169 (#2/#18) — the chargeback service enqueues CHARGEBACK_EVIDENCE_DUE
// admin tasks via the liability-ledger facade.
import { LiabilityLedgerModule } from '../liability-ledger/module';

// Global so any payment flow (checkout, refunds, webhook ingestion)
// can inject PaymentOpsFacade / ChargebackService without re-importing.
@Global()
@Module({
  imports: [LiabilityLedgerModule],
  controllers: [AdminPaymentOpsController],
  providers: [AdminAuthGuard, PaymentOpsService, PaymentOpsFacade, ChargebackService],
  exports: [PaymentOpsFacade, ChargebackService],
})
export class PaymentOpsModule {}
