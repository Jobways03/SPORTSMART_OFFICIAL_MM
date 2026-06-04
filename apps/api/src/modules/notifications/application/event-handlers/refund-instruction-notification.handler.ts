import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';
import { safeHtml } from '../../../../core/util/escape-html';

interface RefundRejectedPayload {
  instructionId: string;
  sourceType: string;
  sourceId: string;
  customerId: string;
  amountInPaise: string;
  reason: string;
  // Phase 171 (#5/#6) — a SAFE, finance-picked customer message (optional) +
  // whether the case bounced back to the dispute team (tunes the copy).
  customerVisibleReason?: string | null;
  routedBackToDispute?: boolean;
}

/**
 * Phase 130 — customer notification when finance REJECTS a refund.
 *
 * A buyer-favoured dispute tells the customer (via disputes.decided) that
 * they've been awarded a refund. If finance then rejects the refund
 * instruction (contesting the money movement), the customer would otherwise
 * be left waiting on money that's never coming — and would file a follow-up
 * ticket. This closes that loop with an honest "under review / on hold" note.
 *
 * Deliberately does NOT echo finance's internal rejection reason to the
 * customer (that's internal — it lives in the audit log + the admin view).
 */
@Injectable()
export class RefundInstructionNotificationHandler {
  private readonly logger = new Logger(
    RefundInstructionNotificationHandler.name,
  );

  constructor(
    private readonly notifications: NotificationsPublicFacade,
    // Outbox-replay dedup, consumed by @IdempotentHandler.
    protected readonly eventDedup: EventDeduplicationService,
  ) {}

  @OnEvent('refunds.instruction.rejected')
  @IdempotentHandler()
  async onRejected(event: DomainEvent<RefundRejectedPayload>): Promise<void> {
    const p = event.payload;
    if (!p.customerId) return;
    const amount = `₹${(Number(p.amountInPaise) / 100).toFixed(2)}`;
    // Phase 171 (#6) — if finance supplied a SAFE customer-visible message, use
    // it; otherwise fall back to the standard honest "on hold" copy. We NEVER
    // echo the internal `reason` (it can contain "fraud signals" etc).
    const safeExtra = (p.customerVisibleReason ?? '').trim();
    try {
      await this.notifications.notify({
        channel: 'EMAIL',
        recipientId: p.customerId,
        subject: `Update on your ${amount} refund`,
        body: safeExtra
          ? safeHtml`<p>We have an update on the ${amount} refund linked to your recent case: ${safeExtra}</p><p>Our team will follow up with the outcome — you don't need to take any action right now.</p>`
          : safeHtml`<p>We're carrying out an additional review of the ${amount} refund linked to your recent case, and it has been placed on hold.</p><p>Our team will follow up with the outcome — you don't need to take any action right now.</p>`,
        eventType: 'refunds.notification',
        eventId: p.instructionId,
      });
    } catch (err) {
      this.logger.error(
        `Refund-rejected notification failed for ${p.instructionId}: ${
          (err as Error).message
        }`,
      );
    }
  }
}
