import { Module } from '@nestjs/common';

// Presentation
import { CustomerAddressController } from './controllers/customer-address.controller';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { CheckoutController } from './controllers/checkout.controller';

// Application – services
import { CheckoutSessionService } from './application/services/checkout-session.service';
import { DeferredOrderService } from './application/services/deferred-order.service';
import { CheckoutService } from './application/services/checkout.service';
import { StockRestoreService } from '../orders/application/services/stock-restore.service';
import { CustomerAddressService } from './application/services/customer-address.service';
import { CustomerOrdersService } from './application/services/customer-orders.service';

// Application – jobs
import { OrderFinalizationRecoveryCron } from './application/jobs/order-finalization-recovery.cron';

// Application – facade
import { CheckoutPublicFacade } from './application/facades/checkout-public.facade';

// Domain – repository token
import { CHECKOUT_REPOSITORY } from './domain/repositories/checkout.repository.interface';

// Infrastructure – repository implementation
import { PrismaCheckoutRepository } from './infrastructure/repositories/prisma-checkout.repository';

// Shared
import { UserAuthGuard } from '../../core/guards';
import { CatalogModule } from '../catalog/module';
import { FranchiseModule } from '../franchise/module';
import { DiscountsModule } from '../discounts/discounts.module';
import { ShippingOptionsModule } from '../shipping-options/shipping-options.module';
import { AffiliateModule } from '../affiliate/module';
import { WalletModule } from '../wallet/module';
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';
import { MoneyModule } from '../../core/money/money.module';
// Phase 6 GST — TaxSnapshotService runs after every order to write
// snapshots + summaries even when no discount applies.
import { TaxModule } from '../tax/module';
import { forwardRef } from '@nestjs/common';
import { CodModule } from '../cod/module';
// Phase 67 (2026-05-22) — order.placed audit log (audit Gap #25).
import { AuditModule } from '../audit/module';
// Phase 69 (2026-05-22) — Phase 67 audit Gap #7. Per-seller
// commission rate snapshot at place-order time.
import { CommissionModule } from '../commission/module';
// Phase 70 (2026-05-22) — Phase 66 audit Gap #3/#10, Phase 67
// audit Gap #4. Payment entity scaffolding — populated alongside
// the existing MasterOrder columns by the checkout flow.
import { PaymentsModule } from '../payments/module';

@Module({
  imports: [
    forwardRef(() => CatalogModule),
    // Tax → Checkout → Franchise → Tax circular chain; forwardRef
    // mirrors the TaxModule side already declared below.
    forwardRef(() => FranchiseModule),
    forwardRef(() => DiscountsModule),
    ShippingOptionsModule,
    AffiliateModule,
    WalletModule,
    RazorpayModule,
    MoneyModule,
    forwardRef(() => TaxModule),
    CodModule,
    AuditModule,
    forwardRef(() => CommissionModule),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [
    CustomerAddressController,
    CustomerOrdersController,
    CheckoutController,
  ],
  providers: [
    // Guards
    UserAuthGuard,

    // Repository binding (interface -> implementation)
    {
      provide: CHECKOUT_REPOSITORY,
      useClass: PrismaCheckoutRepository,
    },

    // Application services
    CheckoutSessionService,
    DeferredOrderService,
    CheckoutService,
    CustomerAddressService,
    CustomerOrdersService,

    // Follow-up #H8 — stateless helper from the orders module, used by
    // CheckoutService.placeOrder to undo a confirmed stock decrement
    // when wallet debit fails after the order has been committed.
    // Registered as a local provider rather than via OrdersModule
    // import to avoid pulling the full orders surface into checkout
    // (which would introduce a transitive cycle risk).
    StockRestoreService,

    // Phase 69 (2026-05-22) — Phase 67 audit Gaps #1 + #5. Cron
    // that replays tax snapshot for orders whose post-tx work
    // never completed (finalizedAt IS NULL). Leader-elected so
    // a horizontally-scaled cluster only sweeps once per tick.
    OrderFinalizationRecoveryCron,

    // Facade
    CheckoutPublicFacade,
  ],
  exports: [CheckoutPublicFacade],
})
export class CheckoutModule {}
