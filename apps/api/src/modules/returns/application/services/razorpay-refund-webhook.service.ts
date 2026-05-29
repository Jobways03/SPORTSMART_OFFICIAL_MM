import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

// Phase 100 (2026-05-23) — Phase 98 audit Gap #20 + Gap #21 closure.
//
// Pre-Phase-100 the system had no path for Razorpay's async refund
// confirmation: when a refund was accepted as `pending`, our Return
// stayed in REFUND_PROCESSING indefinitely until an admin manually
// confirmed. This service is the landing zone for the refund webhook
// events; it idempotently dedupes (via razorpay_refund_webhook_events.
// event_id @unique) and advances the Return state.

export interface RazorpayRefundWebhookPayload {
  eventId: string;
  eventType: string;
  refundId: string;
  paymentId?: string;
  refundStatus: string;
  amountInPaise?: number;
  rawPayload: Record<string, unknown>;
}

@Injectable()
export class RazorpayRefundWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly eventBus: EventBusService,
  ) {
    this.logger.setContext('RazorpayRefundWebhookService');
  }

  async handleEvent(payload: RazorpayRefundWebhookPayload): Promise<{
    outcome: 'PROCESSED' | 'DUPLICATE' | 'NO_MATCH' | 'NO_OP';
  }> {
    // Idempotent landing — `event_id @unique` rejects duplicates.
    let landing: any;
    try {
      landing = await (this.prisma as any).razorpayRefundWebhookEvent.create({
        data: {
          eventId: payload.eventId,
          eventType: payload.eventType,
          refundId: payload.refundId,
          paymentId: payload.paymentId,
          rawPayload: payload.rawPayload as any,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.log(
          `[razorpay-refund-webhook] duplicate event ${payload.eventId} (already processed)`,
        );
        return { outcome: 'DUPLICATE' };
      }
      throw err;
    }

    // Locate the Return by gateway refund id (we stamped it on
    // refundReference at initiate time).
    const ret = await this.prisma.return.findFirst({
      where: { refundReference: payload.refundId },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        refundAmount: true,
      },
    });
    if (!ret) {
      this.logger.warn(
        `[razorpay-refund-webhook] no Return matches refundReference=${payload.refundId} for event ${payload.eventId}`,
      );
      await this.markProcessed(landing.id, 'NO_MATCH');
      return { outcome: 'NO_MATCH' };
    }

    // Drive the state machine off the Razorpay refund status.
    const lowered = String(payload.refundStatus).toLowerCase();
    if (lowered === 'processed') {
      if (ret.status === 'REFUNDED' || ret.status === 'COMPLETED') {
        await this.markProcessed(landing.id, 'ALREADY_REFUNDED');
        return { outcome: 'NO_OP' };
      }
      await this.prisma.return.update({
        where: { id: ret.id },
        data: {
          status: 'REFUNDED' as any,
          refundProcessedAt: new Date(),
          refundFailureReason: null,
        },
      });
      await this.prisma.returnStatusHistory.create({
        data: {
          returnId: ret.id,
          fromStatus: ret.status as any,
          toStatus: 'REFUNDED' as any,
          changedBy: 'SYSTEM',
          changedById: null as any,
          notes: `Razorpay refund.processed webhook (event ${payload.eventId})`,
        },
      });
      await this.eventBus.publish({
        eventName: 'returns.refund.completed',
        aggregate: 'Return',
        aggregateId: ret.id,
        occurredAt: new Date(),
        payload: {
          returnId: ret.id,
          returnNumber: ret.returnNumber,
          refundAmount: Number(ret.refundAmount),
          refundReference: payload.refundId,
          processedBy: 'SYSTEM',
        },
      });
      await this.markProcessed(landing.id, 'FLIPPED_REFUNDED');
      this.logger.log(
        `[razorpay-refund-webhook] Return ${ret.returnNumber} flipped to REFUNDED via event ${payload.eventId}`,
      );
      return { outcome: 'PROCESSED' };
    }
    if (lowered === 'failed') {
      if (ret.status === 'REFUNDED') {
        // Conflict: gateway later says failed but our record says
        // settled. Log + leave alone (manual reconciliation).
        this.logger.error(
          `[razorpay-refund-webhook] CONFLICT — Return ${ret.returnNumber} already REFUNDED but webhook says failed (event ${payload.eventId})`,
        );
        await this.markProcessed(landing.id, 'CONFLICT_REFUNDED_VS_FAILED');
        return { outcome: 'NO_OP' };
      }
      await this.prisma.return.update({
        where: { id: ret.id },
        data: {
          refundFailureReason: `Razorpay refund.failed webhook (event ${payload.eventId})`,
        },
      });
      await this.eventBus.publish({
        eventName: 'returns.refund.failed',
        aggregate: 'Return',
        aggregateId: ret.id,
        occurredAt: new Date(),
        payload: {
          returnId: ret.id,
          returnNumber: ret.returnNumber,
          refundReference: payload.refundId,
          reason: payload.rawPayload,
        },
      });
      await this.markProcessed(landing.id, 'FAILED_RECORDED');
      this.logger.log(
        `[razorpay-refund-webhook] Return ${ret.returnNumber} recorded refund.failed via event ${payload.eventId}`,
      );
      return { outcome: 'PROCESSED' };
    }
    // pending / unknown — log + no-op.
    await this.markProcessed(landing.id, `IGNORED_${lowered}`);
    return { outcome: 'NO_OP' };
  }

  private async markProcessed(id: string, outcome: string): Promise<void> {
    try {
      await (this.prisma as any).razorpayRefundWebhookEvent.update({
        where: { id },
        data: { processedAt: new Date(), processedOutcome: outcome },
      });
    } catch (err) {
      this.logger.warn(
        `[razorpay-refund-webhook] failed to stamp processed outcome ${outcome} on ${id}: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
    }
  }
}
