import { Module } from '@nestjs/common';
import { ShippingPublicFacade } from './application/facades/shipping-public.facade';
import { TrackingWebhookController } from './presentation/controllers/tracking-webhook.controller';
import { OrdersModule } from '../orders/module';

@Module({
  imports: [OrdersModule],
  controllers: [TrackingWebhookController],
  providers: [ShippingPublicFacade],
  exports: [ShippingPublicFacade],
})
export class ShippingModule {}
