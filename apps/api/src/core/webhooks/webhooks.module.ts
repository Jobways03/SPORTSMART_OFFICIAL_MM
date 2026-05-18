import { Global, Module } from '@nestjs/common';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookDlqSweeperCron } from './webhook-dlq-sweeper.cron';

/**
 * Phase 10 (PR 10.2) — webhook delivery module. The cron lands in a
 * follow-up wiring PR; this module exports the service so domain
 * code can call `webhooks.enqueue(...)` after publishing an event.
 *
 * Phase 10 (2026-05-16) — `WebhookDlqSweeperCron` watches
 * `webhook_deliveries.status = FAILED_DEAD` rows that landed in the
 * last sweep window and emits `webhook.dlq_growing` when a single
 * endpoint exceeds the alert threshold. OpsAlertHandler turns the
 * event into an email to ADMIN_ESCALATION_EMAIL.
 */
@Global()
@Module({
  providers: [WebhookDeliveryService, WebhookDlqSweeperCron],
  exports: [WebhookDeliveryService],
})
export class WebhooksModule {}
