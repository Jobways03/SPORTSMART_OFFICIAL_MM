import { Module, forwardRef } from '@nestjs/common';
import { PaymentsPublicFacade } from './application/facades/payments-public.facade';
import { PaymentStatusPollerService } from './application/services/payment-status-poller.service';
// Phase 66 (2026-05-22) — payment expiry sweep cron (audit Gap #18).
import { PaymentExpirySweepCron } from './application/jobs/payment-expiry-sweep.cron';
// Phase 70 (2026-05-22) — Payment entity scaffolding.
import { PaymentLifecycleService } from './application/services/payment-lifecycle.service';
import { AdminPaymentsController } from './presentation/controllers/admin-payments.controller';
import { PaymentWebhookController } from './presentation/controllers/payment-webhook.controller';
// Phase 66 (audit Gap #14) — customer payment status query.
// Replaces the U-prefix dead stub.
import { GetPaymentStatusController } from './presentation/controllers/get-payment-status.controller';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { OrdersModule } from '../orders/module';
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';
import { FranchiseModule } from '../franchise/module';
import { NotificationsModule } from '../notifications/module';
// Wallet refund on payment-window expiry — OrderExpiredHandler injects
// WalletPublicFacade. WalletModule imports only Razorpay + Audit, so no cycle
// back to Payments.
import { WalletModule } from '../wallet/module';
// Phase 166 (Payment Status Poller audit #1/#12) — the two event consumers
// the poller always needed. Registered as providers so @nestjs/event-emitter
// discovers their @OnEvent handlers (without registration they never fire).
import { OrphanRecoveredHandler } from './application/event-handlers/orphan-recovered.handler';
import { OrderExpiredHandler } from './application/event-handlers/order-expired.handler';

@Module({
  imports: [forwardRef(() => OrdersModule), RazorpayModule, forwardRef(() => FranchiseModule), NotificationsModule, WalletModule],
  controllers: [
    AdminPaymentsController,
    PaymentWebhookController,
    GetPaymentStatusController,
  ],
  providers: [
    PaymentsPublicFacade,
    PaymentStatusPollerService,
    PaymentExpirySweepCron,
    PaymentLifecycleService,
    OrphanRecoveredHandler,
    OrderExpiredHandler,
    AdminAuthGuard,
    UserAuthGuard,
  ],
  exports: [PaymentsPublicFacade, PaymentLifecycleService],
})
export class PaymentsModule {}
