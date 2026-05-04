import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { PaymentOpsService } from './application/services/payment-ops.service';
import { PaymentOpsFacade } from './application/facades/payment-ops.facade';
import { AdminPaymentOpsController } from './presentation/controllers/admin-payment-ops.controller';

// Global so any payment flow (checkout, refunds, webhook ingestion)
// can inject PaymentOpsFacade without re-importing this module.
@Global()
@Module({
  controllers: [AdminPaymentOpsController],
  providers: [AdminAuthGuard, PaymentOpsService, PaymentOpsFacade],
  exports: [PaymentOpsFacade],
})
export class PaymentOpsModule {}
