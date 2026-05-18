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
import * as crypto from 'crypto';
import { EnvService } from '../../../bootstrap/env/env.service';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../core/exceptions';
import { WhatsappSessionService } from '../services/whatsapp-session.service';

/**
 * Phase 6 (2026-05-16) — Meta Cloud WhatsApp webhook receiver.
 *
 * Meta delivers two kinds of requests to this endpoint:
 *
 *   1. **Verification handshake** (one-time during webhook setup):
 *      `GET /integrations/whatsapp/webhook?hub.mode=subscribe&
 *           hub.verify_token=<X>&hub.challenge=<Y>`
 *      We respond with the raw `hub.challenge` as plain text when
 *      our `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches.
 *
 *   2. **Inbound events** (every time a user replies, opts out, or a
 *      delivery status changes):
 *      `POST /integrations/whatsapp/webhook`
 *      Signed with `X-Hub-Signature-256: sha256=<hex>` over the raw
 *      body, keyed by the WhatsApp App Secret. We compute the
 *      expected HMAC and reject mismatches before parsing.
 *
 * Inbound text messages are passed through the session service which
 *   - bumps `lastInboundAt` to open the 24h customer service window
 *   - flips `optedOutAt` when the body is STOP / UNSUBSCRIBE
 *   - flips it back when the body is START
 * The raw payload + parsed text is stored in `whatsapp_inbound` for
 * replay/debug; deduplication is by Meta's `message.id`.
 */

interface MetaWebhookValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: Array<{
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
  }>;
  statuses?: Array<{
    id?: string;
    status?: string;
    recipient_id?: string;
    timestamp?: string;
  }>;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: MetaWebhookValue;
    }>;
  }>;
}

@ApiTags('WhatsApp Webhooks')
@Controller('integrations/whatsapp/webhook')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
    private readonly sessionService: WhatsappSessionService,
  ) {}

  /**
   * GET — Meta verification handshake.
   *
   * Returns the `hub.challenge` as plain text when the verify-token
   * matches what we configured in Meta's webhook setup form. A 401
   * causes Meta to refuse the subscription, which is exactly what
   * we want when a bad token is presented.
   */
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expected = this.envService.getString('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '');
    if (!expected) {
      this.logger.warn(
        'WhatsApp webhook GET received but WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured',
      );
      throw new UnauthorizedAppException('Webhook verification not configured');
    }
    if (mode !== 'subscribe' || verifyToken !== expected) {
      this.logger.warn(
        `WhatsApp webhook GET rejected — mode=${mode} tokenMatch=${verifyToken === expected}`,
      );
      throw new UnauthorizedAppException('Webhook verification failed');
    }
    return challenge ?? '';
  }

  /**
   * POST — inbound events.
   *
   * The request body is verified against `X-Hub-Signature-256` before
   * any parsing. We always return 200 after acknowledgement — Meta
   * retries 5xx aggressively, and a parsing bug on our side would
   * burn rate limits on already-delivered data.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleInbound(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: MetaWebhookPayload,
    @Headers('x-hub-signature-256') signatureHeader?: string,
  ) {
    this.verifySignature(req, signatureHeader);

    if (!body || !Array.isArray(body.entry)) {
      // Malformed but signed — log and ack so Meta doesn't retry.
      this.logger.warn('WhatsApp inbound has no entry array');
      return { received: true };
    }

    let processed = 0;
    for (const entry of body.entry) {
      if (!entry?.changes) continue;
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        if (!value?.messages || value.messages.length === 0) continue;
        for (const message of value.messages) {
          try {
            await this.processMessage(message);
            processed++;
          } catch (err) {
            // Per-message failures are logged but not surfaced — one
            // bad message in a batch must not cause Meta to retry the
            // whole batch (which re-delivers everything else too).
            this.logger.error(
              `Failed to process WhatsApp inbound message id=${message.id}: ${(err as Error).message}`,
            );
          }
        }
      }
    }

    if (processed > 0) {
      this.logger.log(`Processed ${processed} WhatsApp inbound message(s)`);
    }
    return { received: true, processed };
  }

  /**
   * HMAC-SHA256 verification of the raw request body against the
   * configured WhatsApp App Secret. Meta sends the digest in the
   * `X-Hub-Signature-256` header in the form `sha256=<hexlower>`.
   *
   * We require the secret to be configured in production-equivalent
   * envs — without it, any caller could push opt-out flips. The
   * 4xx path uses constant-time compare to avoid signature leak via
   * timing oracle.
   */
  private verifySignature(
    req: RawBodyRequest<Request>,
    headerValue: string | undefined,
  ): void {
    const appSecret = this.envService.getString('WHATSAPP_APP_SECRET', '');
    if (!appSecret) {
      // Refuse to process if the secret is missing — this is the
      // single line that decides whether opt-out state can be
      // forged. We crash loud rather than fail open.
      throw new UnauthorizedAppException(
        'WHATSAPP_APP_SECRET not configured — inbound rejected',
      );
    }
    if (!headerValue) {
      throw new UnauthorizedAppException('Missing X-Hub-Signature-256 header');
    }
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestAppException('Raw request body is not available');
    }

    const expected = crypto
      .createHmac('sha256', appSecret)
      .update(raw)
      .digest('hex');
    const provided = headerValue.startsWith('sha256=')
      ? headerValue.slice(7)
      : headerValue;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedAppException('Invalid WhatsApp webhook signature');
    }
  }

  /**
   * Pull the relevant fields out of a single message + persist them.
   * The session service is the only place that touches the
   * 24h-window / opt-out state — this method just adapts the Meta
   * payload shape into its inputs.
   */
  private async processMessage(message: NonNullable<MetaWebhookValue['messages']>[number]) {
    const providerMessageId = message.id;
    const from = message.from;
    const type = message.type ?? 'unknown';
    if (!providerMessageId || !from) {
      this.logger.warn('WhatsApp inbound missing message.id or message.from');
      return;
    }

    // Extract a text body for STOP-keyword detection. Different
    // message types put the text in different fields.
    let textBody: string | null = null;
    if (type === 'text') textBody = message.text?.body ?? null;
    else if (type === 'button') textBody = message.button?.text ?? null;
    else if (type === 'interactive') {
      textBody =
        message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        null;
    }

    const receivedAt = message.timestamp
      ? new Date(parseInt(message.timestamp, 10) * 1000)
      : new Date();

    const isOptOutSignal = WhatsappSessionService.isOptOutText(textBody);

    // Persist the raw inbound first — append-only audit. Dedupe via
    // unique on providerMessageId so Meta retries are no-ops.
    try {
      await this.prisma.whatsappInbound.create({
        data: {
          providerMessageId,
          fromPhoneE164: WhatsappSessionService.normalisePhone(from),
          messageType: type,
          textBody,
          isOptOutSignal,
          rawPayload: message as any,
          receivedAt,
        },
      });
    } catch (err) {
      // Unique-violation = retry; ignore and exit so we don't bump
      // the session timestamps twice from the same Meta retry.
      if (
        err instanceof Error &&
        /Unique constraint|unique_violation/i.test(err.message)
      ) {
        this.logger.debug(
          `WhatsApp inbound dedup hit — message id ${providerMessageId} already recorded`,
        );
        return;
      }
      throw err;
    }

    // Update the session row — open the 24h window and flip opt-out
    // state if the keyword fired.
    await this.sessionService.recordInbound(from, textBody, receivedAt);
  }
}
