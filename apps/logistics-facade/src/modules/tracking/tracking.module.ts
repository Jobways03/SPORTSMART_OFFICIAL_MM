import { Module } from '@nestjs/common';
import { TrackingController } from './presentation/controllers/tracking.controller';
import { TrackingWebhookController } from './presentation/controllers/tracking-webhook.controller';
import { TrackingService } from './application/services/tracking.service';

@Module({
  controllers: [TrackingController, TrackingWebhookController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
