import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';

interface FiledPayload {
  disputeId: string;
  disputeNumber: string;
  kind: string;
  filedByType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  filedById: string;
  filedByName: string;
  subOrderId: string | null;
  summary: string;
}

interface MessageAddedPayload {
  disputeId: string;
  disputeNumber: string;
  senderType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  senderId: string;
  senderName: string;
  messagePreview: string;
  filedByType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  filedById: string;
  subOrderId: string | null;
  assignedAdminId: string | null;
}

interface DecidedPayload {
  disputeId: string;
  disputeNumber: string;
  outcome: 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT';
  amountInPaise: number | null;
  rationale: string;
  filedByType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  filedById: string;
  subOrderId: string | null;
}

/**
 * Best-effort notifications for dispute events. Three flows:
 *   - filed: notify the *other* side (the affected seller, or buyer if
 *     a seller filed).
 *   - message added: notify the *other* parties on the thread.
 *   - decided: notify the filer with the outcome + amount.
 *
 * Errors are logged and swallowed — never break the upstream tx.
 */
@Injectable()
export class DisputeNotificationHandler {
  private readonly logger = new Logger(DisputeNotificationHandler.name);

  constructor(
    private readonly notifications: NotificationsPublicFacade,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('disputes.filed')
  async onFiled(event: DomainEvent<FiledPayload>) {
    const p = event.payload;
    const sellerId = await this.affectedSellerId(p.subOrderId);
    // Notify the affected seller when buyer files; notify a fallback
    // (no specific buyer notification needed — they just filed it).
    if (p.filedByType === 'CUSTOMER' && sellerId) {
      await this.send(sellerId, {
        subject: `New dispute against your order — ${p.disputeNumber}`,
        body:
          `<p>${p.filedByName} has opened a dispute (${p.kind.replace(/_/g, ' ').toLowerCase()}) ` +
          `on order ${p.disputeNumber}.</p><blockquote>${escape(p.summary)}</blockquote>` +
          `<p>Please respond in your seller dashboard.</p>`,
      });
    }
  }

  @OnEvent('disputes.message.added')
  async onMessage(event: DomainEvent<MessageAddedPayload>) {
    const p = event.payload;
    const sellerId = await this.affectedSellerId(p.subOrderId);

    // Notify the parties who are NOT the sender.
    const targets: string[] = [];
    if (p.senderType !== p.filedByType || p.senderId !== p.filedById) {
      targets.push(p.filedById); // the filer
    }
    if (sellerId && (p.senderType !== 'SELLER' || p.senderId !== sellerId)) {
      targets.push(sellerId);
    }
    if (p.assignedAdminId && p.senderId !== p.assignedAdminId) {
      targets.push(p.assignedAdminId);
    }

    for (const recipientId of new Set(targets)) {
      await this.send(recipientId, {
        subject: `New reply on dispute ${p.disputeNumber}`,
        body:
          `<p>${escape(p.senderName)} replied:</p>` +
          `<blockquote>${escape(p.messagePreview)}</blockquote>`,
      });
    }
  }

  @OnEvent('disputes.decided')
  async onDecided(event: DomainEvent<DecidedPayload>) {
    const p = event.payload;
    const outcomeLabel = p.outcome
      .replace('RESOLVED_', '')
      .toLowerCase();
    const amountLine =
      p.amountInPaise != null
        ? `<p><strong>Refund amount:</strong> ₹${(p.amountInPaise / 100).toFixed(2)}</p>`
        : '';
    await this.send(p.filedById, {
      subject: `Dispute ${p.disputeNumber} — decision: ${outcomeLabel}`,
      body:
        `<p>The Sportsmart team has decided your dispute in favour of the <strong>${outcomeLabel}</strong>.</p>` +
        amountLine +
        `<blockquote>${escape(p.rationale)}</blockquote>`,
    });
  }

  // ── helpers ──────────────────────────────────────────────────────

  private async affectedSellerId(subOrderId: string | null): Promise<string | null> {
    if (!subOrderId) return null;
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { sellerId: true },
    });
    return sub?.sellerId ?? null;
  }

  private async send(
    recipientId: string,
    args: { subject: string; body: string },
  ): Promise<void> {
    try {
      await this.notifications.notify({
        channel: 'EMAIL',
        recipientId,
        subject: args.subject,
        body: args.body,
        eventType: 'disputes.notification',
      });
    } catch (err) {
      this.logger.error(`Dispute notification failed: ${(err as Error).message}`);
    }
  }
}

// Minimal HTML escape — body is rendered as email HTML; vars come from
// user input so we must defang.
function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
