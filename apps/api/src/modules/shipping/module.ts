import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '../../core/guards';
import { IThinkModule } from '../../integrations/ithink/ithink.module';
import { OrdersModule } from '../orders/module';

import { ShippingPublicFacade } from './application/facades/shipping-public.facade';
import { IngestTrackingUpdateUseCase } from './application/use-cases/ingest-tracking-update.use-case';
import { IThinkTrackingPollerCron } from './infrastructure/crons/ithink-tracking-poller.cron';
import { shippingProviders } from './infrastructure/providers/shipping.providers';
import { AdminShippingController } from './presentation/controllers/admin-shipping.controller';
import { TrackingWebhookController } from './presentation/controllers/tracking-webhook.controller';

@Module({
  imports: [OrdersModule, IThinkModule],
  controllers: [TrackingWebhookController, AdminShippingController],
  providers: [
    AdminAuthGuard,
    ShippingPublicFacade,
    IngestTrackingUpdateUseCase,
    IThinkTrackingPollerCron,
    ...shippingProviders,
  ],
  exports: [ShippingPublicFacade, IngestTrackingUpdateUseCase, ...shippingProviders],
})
export class ShippingModule {}
