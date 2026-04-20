import { Module } from '@nestjs/common';
import { PaymentsPublicFacade } from './application/facades/payments-public.facade';
import { PaymentStatusPollerService } from './application/services/payment-status-poller.service';
import { AdminPaymentsController } from './presentation/controllers/admin-payments.controller';
import { PaymentWebhookController } from './presentation/controllers/payment-webhook.controller';
import { AdminAuthGuard } from '../../core/guards';
import { OrdersModule } from '../orders/module';
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';
import { FranchiseModule } from '../franchise/module';

@Module({
  imports: [OrdersModule, RazorpayModule, FranchiseModule],
  controllers: [AdminPaymentsController, PaymentWebhookController],
  providers: [PaymentsPublicFacade, PaymentStatusPollerService, AdminAuthGuard],
  exports: [PaymentsPublicFacade],
})
export class PaymentsModule {}
