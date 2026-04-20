import { Module } from '@nestjs/common';

// Presentation
import { CustomerAddressController } from './controllers/customer-address.controller';
import { CustomerOrdersController } from './controllers/customer-orders.controller';
import { CheckoutController } from './controllers/checkout.controller';

// Application – services
import { CheckoutSessionService } from './application/services/checkout-session.service';
import { CheckoutService } from './application/services/checkout.service';
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
import { RazorpayModule } from '../../integrations/razorpay/razorpay.module';

@Module({
  imports: [CatalogModule, FranchiseModule, RazorpayModule],
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

    // Facade
    CheckoutPublicFacade,
  ],
  exports: [CheckoutPublicFacade],
})
export class CheckoutModule {}
