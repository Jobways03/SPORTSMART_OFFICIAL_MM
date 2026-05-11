import { Module } from '@nestjs/common';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { ShippingOptionsService } from './application/services/shipping-options.service';
import { ShippingOptionsPublicFacade } from './application/facades/shipping-options-public.facade';
import { AdminShippingOptionsController } from './presentation/controllers/admin-shipping-options.controller';
import { CustomerShippingOptionsController } from './presentation/controllers/customer-shipping-options.controller';

@Module({
  controllers: [
    AdminShippingOptionsController,
    CustomerShippingOptionsController,
  ],
  providers: [
    AdminAuthGuard,
    UserAuthGuard,
    ShippingOptionsService,
    ShippingOptionsPublicFacade,
  ],
  exports: [ShippingOptionsPublicFacade],
})
export class ShippingOptionsModule {}
