import { Module } from '@nestjs/common';

// Presentation
import { CustomerAddressController } from './controllers/customer-address.controller';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { CheckoutController } from './controllers/checkout.controller';

// Application – services
import { CheckoutSessionService } from './application/services/checkout-session.service';
import { CheckoutService } from './application/services/checkout.service';
import { StockRestoreService } from '../orders/application/services/stock-restore.service';
import { CustomerAddressService } from './application/services/customer-address.service';
import { CustomerOrdersService } from './application/services/customer-orders.service';

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

@Module({
  imports: [
    CatalogModule,
    FranchiseModule,
    DiscountsModule,
    ShippingOptionsModule,
    AffiliateModule,
    WalletModule,
    RazorpayModule,
    MoneyModule,
    forwardRef(() => TaxModule),
    CodModule,
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

    // Facade
    CheckoutPublicFacade,
  ],
  exports: [CheckoutPublicFacade],
})
export class CheckoutModule {}
