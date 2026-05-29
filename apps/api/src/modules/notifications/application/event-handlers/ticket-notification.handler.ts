import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';
import { safeHtml } from '../../../../core/util/escape-html';

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

interface TicketStatusChangedPayload {
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  fromStatus: string;
  toStatus: string;
  changedByAdminId?: string;
  recipientType: 'CUSTOMER' | 'SELLER' | 'FRANCHISE' | 'AFFILIATE';
  recipientEmail: string;
  recipientName: string;
}

interface TicketAssignedPayload {
  ticketId: string;
  ticketNumber: string;
  assigneeId: string;
  assigneeEmail: string;
  assigneeName: string;
  assignedByAdminId?: string | null;
}

interface TicketPriorityChangedPayload {
  ticketId: string;
  ticketNumber: string;
  fromPriority: string;
  toPriority: string;
  assigneeId: string;
  assigneeEmail: string;
  assigneeName: string;
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

  /**
   * Fires on an explicit admin status transition. Emails the ticket creator
   * when the ticket reaches a customer-relevant terminal state (RESOLVED /
   * CLOSED), using the snapshotted creator email so no polymorphic-actor
   * lookup is needed. Other transitions are internal workflow and don't email.
   */
  @OnEvent('tickets.status.changed')
  @IdempotentHandler()
  async onTicketStatusChanged(event: DomainEvent<TicketStatusChangedPayload>) {
    const p = event.payload;
    if (p.toStatus !== 'RESOLVED' && p.toStatus !== 'CLOSED') return;
    if (!p.recipientEmail) return;

    const verb = p.toStatus === 'RESOLVED' ? 'resolved' : 'closed';
    const ticketUrl = this.deepLinkForActor(p.recipientType, p.ticketId);
    try {
      await this.notifications.notify({
        channel: 'EMAIL',
        to: p.recipientEmail,
        subject: `Your support ticket ${p.ticketNumber} was ${verb}`,
        body: safeHtml`<p>Hi ${p.recipientName},</p><p>Your support ticket <strong>${p.ticketNumber}</strong> (&ldquo;${p.ticketSubject}&rdquo;) has been ${verb}.</p><p><a href="${ticketUrl}">View your ticket</a></p>`,
        eventType: 'tickets.status.notification',
        eventId: p.ticketId,
      });
    } catch (err) {
      this.logger.error(
        `Failed ticket status notification: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Fires when a ticket is assigned to an admin — emails the assignee so a
   * newly-routed ticket doesn't sit unseen. Un-assign publishes no event.
   */
  @OnEvent('tickets.assigned')
  @IdempotentHandler()
  async onTicketAssigned(event: DomainEvent<TicketAssignedPayload>) {
    const p = event.payload;
    if (!p.assigneeEmail) return;
    const adminBase = process.env.ADMIN_PORTAL_URL ?? '';
    const ticketUrl = `${adminBase}/dashboard/support/${p.ticketId}`;
    try {
      await this.notifications.notify({
        channel: 'EMAIL',
        to: p.assigneeEmail,
        subject: `Support ticket ${p.ticketNumber} assigned to you`,
        body: safeHtml`<p>Hi ${p.assigneeName},</p><p>Support ticket <strong>${p.ticketNumber}</strong> has been assigned to you.</p><p><a href="${ticketUrl}">Open the ticket</a></p>`,
        eventType: 'tickets.assigned.notification',
        eventId: p.ticketId,
      });
    } catch (err) {
      this.logger.error(
        `Failed ticket assignment notification: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Phase 131 — fires when a ticket is ESCALATED (priority raised). Only the
   * current assignee is notified, and the service emits nothing on
   * de-escalations or self-made changes — so any event here is a genuine
   * heads-up that their ticket just got more urgent.
   */
  @OnEvent('tickets.priority.changed')
  @IdempotentHandler()
  async onTicketPriorityChanged(
    event: DomainEvent<TicketPriorityChangedPayload>,
  ) {
    const p = event.payload;
    if (!p.assigneeEmail) return;
    const adminBase = process.env.ADMIN_PORTAL_URL ?? '';
    const ticketUrl = `${adminBase}/dashboard/support/${p.ticketId}`;
    try {
      await this.notifications.notify({
        channel: 'EMAIL',
        to: p.assigneeEmail,
        subject: `Support ticket ${p.ticketNumber} escalated to ${p.toPriority}`,
        body: safeHtml`<p>Hi ${p.assigneeName},</p><p>Support ticket <strong>${p.ticketNumber}</strong> assigned to you has been escalated from <strong>${p.fromPriority}</strong> to <strong>${p.toPriority}</strong>.</p><p><a href="${ticketUrl}">Open the ticket</a></p>`,
        eventType: 'tickets.priority.notification',
        eventId: p.ticketId,
      });
    } catch (err) {
      this.logger.error(
        `Failed ticket escalation notification: ${(err as Error).message}`,
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
