import { Global, Module } from '@nestjs/common';
import { WebhookDeliveryService } from './webhook-delivery.service';

/**
 * Phase 10 (PR 10.2) — webhook delivery module. The cron lands in a
 * follow-up wiring PR; this module exports the service so domain
 * code can call `webhooks.enqueue(...)` after publishing an event.
 */
@Global()
@Module({
  providers: [WebhookDeliveryService],
  exports: [WebhookDeliveryService],
})
export class WebhooksModule {}
