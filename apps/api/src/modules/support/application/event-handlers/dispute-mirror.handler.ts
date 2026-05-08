import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { SupportService } from '../services/support.service';

interface DisputeMessageAddedPayload {
  disputeId: string;
  disputeNumber: string;
  /** Just-created DisputeMessage row id; carried into the mirror as provenance. */
  messageId: string;
  senderType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  senderId: string;
  senderName: string;
  body: string;
  messagePreview: string;
  filedByType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  filedById: string;
  subOrderId: string | null;
  assignedAdminId: string | null;
  /**
   * Phase 11 (post-Phase-10) — populated when the dispute was promoted
   * from a support ticket. The customer never knew the dispute existed
   * — they posted on the ticket. We mirror admin replies back onto the
   * ticket so the customer reads them in their support thread.
   */
  sourceTicketId: string | null;
}

interface DisputeDecidedPayload {
  disputeId: string;
  disputeNumber: string;
  outcome: 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT';
  amountInPaise: number | null;
  rationale: string;
  decidedByAdminId: string;
  filedByType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  filedById: string;
  masterOrderId: string | null;
  subOrderId: string | null;
  returnId: string | null;
  sourceTicketId?: string | null;
}

interface DisputeClosedPayload {
  disputeId: string;
  disputeNumber: string;
  sourceTicketId: string;
  closedByAdminId: string | null;
}

/**
 * Customer-facing copy templates per outcome. Industry pattern (per
 * Salesforce macros / Zendesk quick-text) — declarative table, not
 * inline branching, so the language is reviewable + i18n-ready in
 * one place. Functions take the outcome's payload and return the
 * full string so we can interpolate the amount; if the rationale ever
 * needs to leak through, that's a deliberate change here, not a
 * silent if/else mutation.
 *
 * Important: the dispute-side `rationale` is intentionally NOT
 * referenced. It may contain admin-internal language (fraud heuristics,
 * policy thresholds, agent discretion limits) — verbatim mirroring is
 * a leak risk and is uniformly treated as an anti-pattern.
 */
const DECISION_TEMPLATES: Record<
  DisputeDecidedPayload['outcome'],
  (p: DisputeDecidedPayload) => { customerMessage: string; resolutionSummary: string }
> = {
  RESOLVED_BUYER: (p) => {
    const amount = p.amountInPaise
      ? `₹${(p.amountInPaise / 100).toFixed(2)}`
      : 'the agreed amount';
    return {
      customerMessage: `We've reviewed your case and resolved it in your favour. ${amount} is being credited to your wallet — you'll see it shortly.`,
      resolutionSummary: `Resolved in customer's favour (${amount}).`,
    };
  },
  RESOLVED_SPLIT: (p) => {
    const amount = p.amountInPaise
      ? `₹${(p.amountInPaise / 100).toFixed(2)}`
      : 'a partial credit';
    return {
      customerMessage: `We've reviewed your case and a partial resolution has been issued. ${amount} is being credited to your wallet — you'll see it shortly.`,
      resolutionSummary: `Resolved with split outcome (${amount}).`,
    };
  },
  RESOLVED_SELLER: () => ({
    customerMessage: `We've reviewed your case carefully. After examining all available information, we're unable to issue a refund or replacement on this occasion. If you have new information you'd like us to consider, you can re-open this ticket by replying.`,
    resolutionSummary: 'Resolved without refund.',
  }),
};

/**
 * Bridges admin actions on a promoted dispute back onto the customer's
 * support ticket. Two channels:
 *
 *  1. `disputes.message.added` → admin replies on the dispute thread
 *     are reposted on the ticket as `senderName="Support"` so the
 *     customer keeps reading a single, brand-consistent conversation
 *     and never sees the word "dispute".
 *
 *  2. `disputes.decided` → final outcome lands as a friendly
 *     close-out message on the ticket and flips the ticket to
 *     RESOLVED. The decision rationale is rephrased into customer
 *     language; we don't mirror admin-only wording verbatim.
 *
 * Only fires when the dispute carries a `sourceTicketId` — direct-
 * filed disputes (legacy customer/seller/admin filings) are
 * untouched.
 *
 * Decorated with `@IdempotentHandler` so the event-bus retry
 * machinery cannot post duplicate ticket replies. Belt-and-braces
 * with the UNIQUE(mirrored_from_dispute_message_id) constraint on
 * the storage layer.
 */
@Injectable()
export class DisputeMirrorHandler {
  private readonly logger = new Logger(DisputeMirrorHandler.name);

  constructor(
    private readonly support: SupportService,
    // Required by @IdempotentHandler — protected so the decorator
    // can read `this.eventDedup` at runtime.
    protected readonly eventDedup: EventDeduplicationService,
  ) {}

  @OnEvent('disputes.message.added')
  @IdempotentHandler()
  async onMessageAdded(event: DomainEvent<DisputeMessageAddedPayload>) {
    const p = event.payload;
    if (!p.sourceTicketId) return;
    // Only mirror admin replies. Customer/seller messages on the
    // dispute side originated from the ticket via the forward mirror —
    // mirroring them back would create a duplicate.
    if (p.senderType !== 'ADMIN') return;

    try {
      await this.support.mirrorDisputeMessageToTicket({
        ticketId: p.sourceTicketId,
        body: p.body,
        adminId: p.senderId,
        sourceDisputeMessageId: p.messageId,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to mirror dispute ${p.disputeNumber} message back to ticket ${p.sourceTicketId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('disputes.decided')
  @IdempotentHandler()
  async onDecided(event: DomainEvent<DisputeDecidedPayload>) {
    const p = event.payload;
    if (!p.sourceTicketId) return;

    const template = DECISION_TEMPLATES[p.outcome];
    if (!template) {
      this.logger.warn(
        `No decision template registered for outcome ${p.outcome} — skipping ticket relay`,
      );
      return;
    }
    const { customerMessage, resolutionSummary } = template(p);

    try {
      await this.support.resolveTicketAfterDisputeDecision({
        ticketId: p.sourceTicketId,
        customerMessage,
        resolutionSummary,
        adminId: p.decidedByAdminId,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to relay dispute ${p.disputeNumber} decision to ticket ${p.sourceTicketId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Procedural close (admin used the status quick-set to flip the
   * dispute to CLOSED without a refund decision — buyer abandoned,
   * duplicate filing, etc.). Customer's ticket needs to follow so they
   * don't sit on "Awaiting your reply" forever. Generic close-out
   * copy — no money implications, no outcome-specific phrasing. If
   * the customer disagrees, they can re-open the ticket by replying
   * (existing nextStatusOnReply rule flips a RESOLVED ticket back to
   * IN_PROGRESS on customer reply).
   */
  @OnEvent('disputes.closed')
  @IdempotentHandler()
  async onClosed(event: DomainEvent<DisputeClosedPayload>) {
    const p = event.payload;
    if (!p.sourceTicketId) return;

    const customerMessage =
      `We've closed this case from our end. If anything's still unresolved, ` +
      `you can re-open this ticket by replying — we'll pick it up again.`;

    try {
      await this.support.resolveTicketAfterDisputeDecision({
        ticketId: p.sourceTicketId,
        customerMessage,
        resolutionSummary: 'Closed without refund decision.',
        adminId: p.closedByAdminId ?? 'system',
      });
    } catch (err) {
      this.logger.warn(
        `Failed to relay dispute ${p.disputeNumber} close to ticket ${p.sourceTicketId}: ${(err as Error).message}`,
      );
    }
  }
}
