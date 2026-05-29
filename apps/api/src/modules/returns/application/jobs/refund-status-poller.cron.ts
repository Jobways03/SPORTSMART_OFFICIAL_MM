import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { RazorpayRefundWebhookService } from '../services/razorpay-refund-webhook.service';

// Phase 100 (2026-05-23) — Phase 98 audit Gap #3 closure.
//
// Pre-Phase-100 if Razorpay's refund webhook was dropped (network,
// outage, mis-configured endpoint), the Return stayed in
// REFUND_PROCESSING forever. This cron is a defence-in-depth fallback
// that polls Razorpay for the status of every Return stuck in
// REFUND_PROCESSING for > N minutes (15min default) with a populated
// refundReference. If the gateway says `processed`, we flip to
// REFUNDED via the same code path as the webhook handler.
//
// Cadence: every 15 minutes. Per-row work happens INSIDE the webhook
// service which is idempotent on `event_id` so a webhook + poller
// race resolves cleanly.

@Injectable()
export class RefundStatusPollerCron {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly env: EnvService,
    private readonly razorpay: RazorpayAdapter,
    private readonly webhookService: RazorpayRefundWebhookService,
    private readonly instrumentation: CronInstrumentationService,
    private readonly leader: LeaderElectedCron,
  ) {
    this.logger.setContext('RefundStatusPollerCron');
  }

  enabled(): boolean {
    return this.env.getBoolean(
      'REFUND_STATUS_POLLER_ENABLED' as any,
      true,
    );
  }

  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('return-refund-status-poller', 20 * 60, async () => {
      await this.instrumentation.wrap(
        'returns.refund_status_poller',
        async () => {
          const minAgeMinutes = this.env.getNumber(
            'REFUND_STATUS_POLLER_MIN_AGE_MIN' as any,
            15,
          );
          const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);

          const candidates = await this.prisma.return.findMany({
            where: {
              status: 'REFUND_PROCESSING' as any,
              refundReference: { not: null },
              refundLastAttemptAt: { lt: cutoff },
            },
            select: {
              id: true,
              returnNumber: true,
              refundReference: true,
              masterOrder: { select: { razorpayPaymentId: true } },
            },
            take: 100,
          });
          if (candidates.length === 0) return { polled: 0, advanced: 0 };

          let advanced = 0;
          for (const ret of candidates) {
            const paymentId = ret.masterOrder?.razorpayPaymentId;
            if (!paymentId || !ret.refundReference) continue;
            // Only poll refund-ids that look like Razorpay's format
            // (`rfnd_<16+ chars>`). Skip wallet / pending-approval ids.
            if (!ret.refundReference.startsWith('rfnd_')) continue;
            try {
              const status = await this.razorpay.getRefundStatus(
                paymentId,
                ret.refundReference,
              );
              const out = await this.webhookService.handleEvent({
                eventId: `poll:${ret.refundReference}:${Date.now()}`,
                eventType: `refund.${status.status}`,
                refundId: ret.refundReference,
                paymentId,
                refundStatus: status.status,
                rawPayload: { source: 'poller', status: status as any } as any,
              });
              if (out.outcome === 'PROCESSED') advanced++;
            } catch (err) {
              this.logger.warn(
                `[refund-status-poller] gateway lookup failed for ${ret.returnNumber}: ${
                  (err as Error)?.message ?? 'unknown error'
                }`,
              );
            }
          }

          this.logger.log(
            `Refund status poller scanned ${candidates.length}, advanced ${advanced}`,
          );
          return { polled: candidates.length, advanced };
        },
      );
    });
  }
}
