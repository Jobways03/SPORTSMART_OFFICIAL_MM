import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { SupportPublicFacade } from '../facades/support-public.facade';

interface WhatsappInboundEvent {
  customerId?: string | null;
  phoneE164?: string;
  contactName?: string | null;
  textBody?: string | null;
  mediaId?: string | null;
  messageType?: string;
  providerMessageId?: string;
  isOptOut?: boolean;
}

/**
 * Phase 191 (#4) — surface an inbound WhatsApp message to support.
 *
 * The webhook (integrations/whatsapp) emits `whatsapp.inbound.received`;
 * this handler (in the support module — avoids a Support→Notifications→
 * WhatsApp import cycle) files a system ticket so the message doesn't rot
 * in `whatsapp_inbound`. Guards:
 *   - opt-out / empty messages don't open a ticket
 *   - the phone must resolve to a known customer (we need an email/name)
 *   - a Redis NX lock dedups a chatty conversation to ONE ticket / hour /
 *     customer (full conversation threading is a follow-up).
 */
@Injectable()
export class WhatsappInboundTicketHandler {
  private readonly logger = new Logger(WhatsappInboundTicketHandler.name);
  private static readonly DEDUP_TTL_SECONDS = 3600;

  constructor(
    private readonly support: SupportPublicFacade,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @OnEvent('whatsapp.inbound.received')
  async onInbound(evt: WhatsappInboundEvent): Promise<void> {
    if (evt.isOptOut) return; // STOP/UNSUBSCRIBE is not a support request
    if (!evt.customerId) return; // anonymous phone — no account to attach
    if (!evt.textBody && !evt.mediaId) return; // nothing actionable

    // Dedup: one WhatsApp ticket per customer per hour (NX lock).
    try {
      const lock = await this.redis
        .getClient()
        .set(`wa:ticket:${evt.customerId}`, '1', 'EX', WhatsappInboundTicketHandler.DEDUP_TTL_SECONDS, 'NX');
      if (lock !== 'OK') return; // an open WhatsApp ticket already exists
    } catch {
      // Redis down → fall through and create the ticket (better a possible
      // duplicate than a lost customer message).
    }

    const user = await this.prisma.user.findUnique({
      where: { id: evt.customerId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) return;

    const preview = evt.textBody
      ? evt.textBody.slice(0, 80)
      : `[${evt.messageType ?? 'media'} message]`;
    const body = evt.textBody
      ? evt.textBody
      : `Customer sent a ${evt.messageType ?? 'media'} message via WhatsApp` +
        (evt.mediaId ? ` (media id ${evt.mediaId}).` : '.');

    try {
      await this.support.createSystemTicket({
        onBehalfOf: {
          type: 'CUSTOMER',
          id: user.id,
          name: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email,
        },
        subject: `WhatsApp: ${preview}`,
        body,
        priority: 'HIGH',
      });
      this.logger.log(`Opened a support ticket from a WhatsApp message for customer ${user.id}`);
    } catch (err) {
      this.logger.error(`Failed to open WhatsApp support ticket: ${(err as Error).message}`);
    }
  }
}
