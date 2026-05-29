import { Module } from '@nestjs/common';
import { AdminAuthGuard, PermissionsGuard, RolesGuard, UserAuthGuard } from '../../core/guards';
import { ShippingOptionsService } from './application/services/shipping-options.service';
import { ShippingOptionsPublicFacade } from './application/facades/shipping-options-public.facade';
// Phase 91 (2026-05-23) — zone × rate × surcharge resolver.
import { ShippingPricingService } from './application/services/shipping-pricing.service';
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
    // Phase 91 — Gap #11/#23 admin tightening uses Roles + Permissions
    // guards on the admin controller; register both providers explicitly.
    PermissionsGuard,
    RolesGuard,
    ShippingOptionsService,
    ShippingOptionsPublicFacade,
    ShippingPricingService,
  ],
  exports: [ShippingOptionsPublicFacade, ShippingPricingService],
})
export class ShippingOptionsModule {}
