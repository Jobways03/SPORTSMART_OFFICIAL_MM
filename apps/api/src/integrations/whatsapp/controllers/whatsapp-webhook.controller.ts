import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { EnvService } from '../../../bootstrap/env/env.service';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../bootstrap/cache/redis.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../core/exceptions';
import { AuditPublicFacade } from '../../../modules/audit/application/facades/audit-public.facade';
import { WhatsappSessionService } from '../services/whatsapp-session.service';

interface MetaMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  context?: { id?: string; from?: string };
  image?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string };
  sticker?: { id?: string; mime_type?: string };
}

interface MetaStatus {
  id?: string;
  status?: string; // sent | delivered | read | failed
  recipient_id?: string;
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface MetaContact {
  profile?: { name?: string };
  wa_id?: string;
}

interface MetaWebhookValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: MetaWebhookValue }> }>;
}

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'] as const;
const MAX_EVENTS_PER_PAYLOAD = 1000; // #6 — batch cap.
const SIG_FAIL_PREFIX = 'wa:sigfail:';
const SIG_FAIL_THRESHOLD = 20;
const SIG_FAIL_TTL_SECONDS = 600;

/** #13 — Meta delivery-error code → canonical NotificationFailureCode. */
function mapMetaError(code?: number): string {
  switch (code) {
    case 131045: // recipient not a valid WhatsApp user
      return 'INVALID_PHONE';
    case 470:
    case 131051: // template / HSM issue
      return 'MALFORMED_TEMPLATE';
    case 131047: // re-engagement required (outside 24h window)
    case 131026: // message undeliverable
    case 131000: // generic
    default:
      return 'PROVIDER_ERROR';
  }
}

/**
 * Phase 6 / Phase 191 — Meta Cloud WhatsApp webhook receiver.
 *
 * GET = verification handshake. POST = inbound events: HMAC-verified, then
 * BOTH inbound messages (persist + customer-match + support-ticket event)
 * AND delivery-status receipts (flip the matching NotificationLog) are
 * processed (Phase 191 closed the statuses[] gap).
 */
@ApiTags('WhatsApp Webhooks')
@Controller('integrations/whatsapp/webhook')
// Phase 191 (#7) — allow Meta's legitimate retry burst, cap abuse.
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
    private readonly sessionService: WhatsappSessionService,
    private readonly events: EventEmitter2,
    private readonly redis: RedisService,
    private readonly audit: AuditPublicFacade,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expected = this.envService.getString('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '');
    if (!expected) {
      this.logger.warn('WhatsApp webhook GET but WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured');
      throw new UnauthorizedAppException('Webhook verification not configured');
    }
    if (mode !== 'subscribe' || verifyToken !== expected) {
      this.logger.warn(`WhatsApp webhook GET rejected — mode=${mode}`);
      throw new UnauthorizedAppException('Webhook verification failed');
    }
    // #17 — Meta always sends hub.challenge on a real handshake; an empty
    // response would be read as a failed subscription.
    if (!challenge) {
      throw new BadRequestAppException('hub.challenge is required');
    }
    return challenge;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleInbound(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: MetaWebhookPayload,
    @Headers('x-hub-signature-256') signatureHeader?: string,
  ) {
    try {
      this.verifySignature(req, signatureHeader);
    } catch (err) {
      // #8/#10 — count + alert + audit forged-signature attempts.
      await this.recordSignatureFailure(req, (err as Error).message);
      throw err;
    }

    if (!body || !Array.isArray(body.entry)) {
      this.logger.warn('WhatsApp inbound has no entry array');
      return { received: true };
    }

    // #6 — bound the work a single payload can trigger.
    let budget = MAX_EVENTS_PER_PAYLOAD;
    let processedMessages = 0;
    let processedStatuses = 0;

    for (const entry of body.entry) {
      const wabaId = entry?.id ?? null; // #12
      if (!entry?.changes) continue;
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        if (!value) continue;

        for (const message of value.messages ?? []) {
          if (budget-- <= 0) break;
          try {
            await this.processMessage(message, wabaId, value.contacts);
            processedMessages++;
          } catch (err) {
            this.logger.error(`Failed WhatsApp message id=${message.id}: ${(err as Error).message}`);
          }
        }
        // #1 — delivery receipts (the half that was silently dropped).
        for (const status of value.statuses ?? []) {
          if (budget-- <= 0) break;
          try {
            await this.processStatus(status, wabaId);
            processedStatuses++;
          } catch (err) {
            this.logger.error(`Failed WhatsApp status id=${status.id}: ${(err as Error).message}`);
          }
        }
      }
    }

    if (processedMessages > 0 || processedStatuses > 0) {
      this.logger.log(
        `Processed ${processedMessages} WhatsApp message(s) + ${processedStatuses} status(es)`,
      );
    }
    return { received: true, processed: processedMessages, statuses: processedStatuses };
  }

  // ── inbound message ─────────────────────────────────────────────────
  private async processMessage(
    message: MetaMessage,
    wabaId: string | null,
    contacts?: MetaContact[],
  ): Promise<void> {
    const providerMessageId = message.id;
    const from = message.from;
    const type = message.type ?? 'unknown';
    if (!providerMessageId || !from) {
      this.logger.warn('WhatsApp inbound missing message.id or message.from');
      return;
    }
    const phoneE164 = WhatsappSessionService.normalisePhone(from);
    // #9 — reject a clearly-malformed sender.
    if (!/^\d{10,15}$/.test(phoneE164)) {
      this.logger.warn(`WhatsApp inbound rejected — invalid from phone "${from}"`);
      return;
    }

    let textBody: string | null = null;
    if (type === 'text') textBody = message.text?.body ?? null;
    else if (type === 'button') textBody = message.button?.text ?? null;
    else if (type === 'interactive') {
      textBody =
        message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null;
    }

    // #3 — media reference.
    let mediaId: string | null = null;
    let mediaMimeType: string | null = null;
    if ((MEDIA_TYPES as readonly string[]).includes(type)) {
      const m = (message as any)[type] as { id?: string; mime_type?: string } | undefined;
      mediaId = m?.id ?? null;
      mediaMimeType = m?.mime_type ?? null;
    }

    const repliedToMessageId = message.context?.id ?? null; // #14
    const contactName = contacts?.find((c) => c.wa_id === from)?.profile?.name ?? null; // #5
    const receivedAt = message.timestamp
      ? new Date(parseInt(message.timestamp, 10) * 1000)
      : new Date();
    const isOptOutSignal = WhatsappSessionService.isOptOutText(textBody);

    // #5 — match the phone to a platform customer.
    const customerId = await this.matchCustomer(phoneE164);

    try {
      await this.prisma.whatsappInbound.create({
        data: {
          providerMessageId,
          fromPhoneE164: phoneE164,
          messageType: type,
          textBody,
          isOptOutSignal,
          mediaId,
          mediaMimeType,
          repliedToMessageId,
          contactName,
          customerId,
          wabaId,
          rawPayload: message as any,
          receivedAt,
        },
      });
    } catch (err) {
      if (err instanceof Error && /Unique constraint|unique_violation/i.test(err.message)) {
        this.logger.debug(`WhatsApp inbound dedup hit — ${providerMessageId}`);
        return;
      }
      throw err;
    }

    await this.sessionService.recordInbound(from, textBody, receivedAt);
    // #5 — persist the customer link on the session row.
    if (customerId) {
      await this.prisma.whatsappSession
        .updateMany({ where: { phoneE164, customerId: null }, data: { customerId } })
        .catch(() => undefined);
    }

    // #10 — audit the privacy-relevant opt-out flip (not every chat line).
    if (isOptOutSignal) {
      await this.audit
        .writeAuditLog({
          actorId: customerId ?? `whatsapp:${phoneE164.slice(-4)}`,
          actorRole: 'CUSTOMER',
          action: 'notifications.whatsapp.opt_out',
          module: 'notifications',
          resource: 'WhatsappSession',
          resourceId: phoneE164,
        })
        .catch(() => undefined);
    }

    // #4 — surface to support (decoupled; the support module handles it).
    this.events.emit('whatsapp.inbound.received', {
      customerId,
      phoneE164,
      contactName,
      textBody,
      mediaId,
      messageType: type,
      providerMessageId,
      isOptOut: isOptOutSignal,
    });
  }

  // ── delivery status (#1/#2/#13) ─────────────────────────────────────
  private async processStatus(status: MetaStatus, wabaId: string | null): Promise<void> {
    const providerMessageId = status.id;
    const raw = (status.status ?? '').toUpperCase();
    if (!providerMessageId || !['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(raw)) return;
    const metaStatus = raw as 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
    const at = status.timestamp ? new Date(parseInt(status.timestamp, 10) * 1000) : new Date();
    const err = status.errors?.[0];

    // Persist the receipt (idempotent on (providerMessageId, status)).
    try {
      await this.prisma.whatsappStatus.create({
        data: {
          providerMessageId,
          status: metaStatus,
          recipientId: status.recipient_id ?? null,
          errorCode: err?.code != null ? String(err.code) : null,
          errorTitle: err?.title ?? null,
          wabaId,
          rawPayload: status as any,
          receivedAt: at,
        },
      });
    } catch (e) {
      if (e instanceof Error && /Unique constraint|unique_violation/i.test(e.message)) return; // dedup
      throw e;
    }

    // #2 — flip the matching outbound NotificationLog row(s).
    if (metaStatus === 'DELIVERED' || metaStatus === 'READ') {
      await this.prisma.notificationLog.updateMany({
        where: { providerMessageId, status: 'SENT' },
        data: { status: 'DELIVERED', deliveredAt: at },
      });
    } else if (metaStatus === 'FAILED') {
      await this.prisma.notificationLog.updateMany({
        where: { providerMessageId, status: { in: ['SENT', 'QUEUED', 'RETRY'] } },
        data: {
          status: 'FAILED',
          failedAt: at,
          failureCode: mapMetaError(err?.code) as any,
          failureReason: err ? `Meta ${err.code}: ${err.title ?? err.message ?? ''}`.slice(0, 1000) : null,
        },
      });
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private async matchCustomer(phoneE164: string): Promise<string | null> {
    // User.phone format isn't guaranteed; try the common variants.
    const variants = new Set<string>([phoneE164, `+${phoneE164}`]);
    if (phoneE164.startsWith('91') && phoneE164.length > 10) variants.add(phoneE164.slice(2));
    const user = await this.prisma.user.findFirst({
      where: { phone: { in: [...variants] } },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async recordSignatureFailure(
    req: RawBodyRequest<Request>,
    detail: string,
  ): Promise<void> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    try {
      const key = `${SIG_FAIL_PREFIX}${ip}`;
      const client = this.redis.getClient();
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, SIG_FAIL_TTL_SECONDS);
      if (count === SIG_FAIL_THRESHOLD) {
        this.logger.error(
          `[ALERT] WhatsApp webhook: ${count} signature failures from ${ip} in ${SIG_FAIL_TTL_SECONDS}s — possible forgery/probe.`,
        );
        this.events.emit('whatsapp.webhook.signature_failing', { ip, count, severity: 90, detail });
        await this.audit
          .writeAuditLog({
            action: 'notifications.whatsapp.signature_failed',
            module: 'notifications',
            resource: 'WhatsappWebhook',
            resourceId: ip,
            metadata: { count, detail },
            ipAddress: ip,
          })
          .catch(() => undefined);
      }
    } catch {
      /* alerting must never break the 401 path */
    }
  }

  private verifySignature(req: RawBodyRequest<Request>, headerValue: string | undefined): void {
    const appSecret = this.envService.getString('WHATSAPP_APP_SECRET', '');
    if (!appSecret) {
      throw new UnauthorizedAppException('WHATSAPP_APP_SECRET not configured — inbound rejected');
    }
    if (!headerValue) throw new UnauthorizedAppException('Missing X-Hub-Signature-256 header');
    const raw = req.rawBody;
    if (!raw) throw new BadRequestAppException('Raw request body is not available');

    const expected = crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
    const provided = headerValue.startsWith('sha256=') ? headerValue.slice(7) : headerValue;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedAppException('Invalid WhatsApp webhook signature');
    }
  }
}
