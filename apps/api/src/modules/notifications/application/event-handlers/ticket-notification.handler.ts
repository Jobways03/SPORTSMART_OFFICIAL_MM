import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';

interface TicketReplyPayload {
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  // Recipient — the ticket creator (only notified for ADMIN replies)
  recipientType: 'CUSTOMER' | 'SELLER' | 'FRANCHISE' | 'AFFILIATE';
  recipientId: string;
  recipientName: string;
  // Reply content
  senderType: 'ADMIN';
  senderName: string;
  messagePreview: string;
}

@Injectable()
export class TicketNotificationHandler {
  private readonly logger = new Logger(TicketNotificationHandler.name);

  constructor(
    private readonly notifications: NotificationsPublicFacade,
    // Phase 2 / M21-M32 — outbox-replay dedup. See wallet handler.
    protected readonly eventDedup: EventDeduplicationService,
  ) {}

  /**
   * Fires when ADMIN replies on a non-internal note. Notifies the ticket
   * creator across all four actor types — the worker resolves the right
   * email/phone from the User/Seller/FranchisePartner/Affiliate tables.
   * Per-actor portal URLs make the deep-link land on the right login.
   */
  @OnEvent('tickets.message.added')
  @IdempotentHandler()
  async onTicketReplied(event: DomainEvent<TicketReplyPayload>) {
    const p = event.payload;
    if (p.senderType !== 'ADMIN') return;

    const ticketUrl = this.deepLinkForActor(p.recipientType, p.ticketId);

    try {
      await this.notifications.notifyFromTemplate({
        eventClass: 'ticket',
        templateKey: 'ticket.replied.email',
        recipientId: p.recipientId,
        eventId: p.ticketId,
        vars: {
          customerName: p.recipientName,
          ticketNumber: p.ticketNumber,
          ticketSubject: p.ticketSubject,
          messagePreview: p.messagePreview,
          ticketUrl,
          preferencesUrl: process.env.STOREFRONT_URL
            ? `${process.env.STOREFRONT_URL}/account/notifications`
            : '/account/notifications',
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed ticket reply notification: ${(err as Error).message}`,
      );
    }
  }

  private deepLinkForActor(
    actor: TicketReplyPayload['recipientType'],
    ticketId: string,
  ): string {
    const env = process.env;
    const base = (() => {
      switch (actor) {
        case 'CUSTOMER':  return env.STOREFRONT_URL ?? '';
        case 'SELLER':    return env.SELLER_PORTAL_URL ?? '';
        case 'FRANCHISE': return env.FRANCHISE_PORTAL_URL ?? '';
        case 'AFFILIATE': return env.AFFILIATE_PORTAL_URL ?? '';
      }
    })();
    const path = (() => {
      switch (actor) {
        case 'CUSTOMER':  return `/account/support/${ticketId}`;
        case 'SELLER':    return `/dashboard/support/${ticketId}`;
        case 'FRANCHISE': return `/dashboard/support/${ticketId}`;
        case 'AFFILIATE': return `/dashboard/support/${ticketId}`;
      }
    })();
    return `${base}${path}`;
  }
}
