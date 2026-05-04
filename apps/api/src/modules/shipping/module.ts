import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { ShippingPublicFacade } from './application/facades/shipping-public.facade';
import { TrackingWebhookController } from './presentation/controllers/tracking-webhook.controller';
import { AdminShippingController } from './presentation/controllers/admin-shipping.controller';
import { OrdersModule } from '../orders/module';

@Module({
  imports: [OrdersModule],
  controllers: [TrackingWebhookController, AdminShippingController],
  providers: [AdminAuthGuard, ShippingPublicFacade],
  exports: [ShippingPublicFacade],
})
export class ShippingModule {}
