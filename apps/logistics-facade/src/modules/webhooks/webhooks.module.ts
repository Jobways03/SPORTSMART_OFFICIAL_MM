import { Module } from '@nestjs/common';
import { PartnerWebhookService } from './application/services/partner-webhook.service';

/**
 * Central inbound-webhook dispatch. The actual `POST /webhooks/:partner`
 * controller lives in modules/tracking — it imports this service to
 * do the heavy lifting. Splitting the controller and the service into
 * separate modules keeps the auth surface (signature, not ApiKey)
 * close to the per-partner mapper that owns it.
 */
@Module({
  providers: [PartnerWebhookService],
  exports: [PartnerWebhookService],
})
export class WebhooksModule {}
