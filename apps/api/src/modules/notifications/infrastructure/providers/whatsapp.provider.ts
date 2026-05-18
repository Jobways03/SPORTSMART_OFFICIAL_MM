import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import {
  INotificationProvider,
  SendArgs,
  SendResult,
} from '../../application/ports/notification-provider.port';
import { WhatsAppAdapter } from '../../../../integrations/whatsapp/adapters/whatsapp.adapter';

/**
 * Phase 6 (2026-05-16) — real WhatsApp provider.
 *
 * Pre-Phase-6 this was a stub that logged to console regardless of
 * configuration, opt-out state, or the 24h window. It now routes
 * through `WhatsAppAdapter`, which enforces:
 *
 *   • opt-out (STOP / UNSUBSCRIBE) — never sends
 *   • 24h customer service window — text only when inside; outside
 *     the window the caller MUST supply a template name (templateKey
 *     on the job, mapped to a Meta-approved HSM template). Without
 *     it the send is refused with a non-retryable failure so the
 *     queue doesn't churn forever.
 *
 * Configuration:
 *   • WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID — when missing,
 *     send returns success with no-op (matches prior stub behaviour
 *     so dev environments aren't blocked).
 */
@Injectable()
export class WhatsAppNotificationProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'WHATSAPP';
  private readonly logger = new Logger(WhatsAppNotificationProvider.name);

  constructor(private readonly adapter: WhatsAppAdapter) {}

  async send(args: SendArgs): Promise<SendResult> {
    const phone = args.to.replace(/\D/g, '');
    if (phone.length < 10) {
      return {
        success: false,
        failureReason: `Invalid WhatsApp number: ${args.to}`,
        retryable: false,
      };
    }

    // Heuristic: when the caller provides a `templateKey` matching a
    // Meta-approved template name, treat it as a template send so
    // outside-window deliveries succeed. The body is forwarded as the
    // single body parameter — that matches the most common HSM shape
    // (1 placeholder, e.g. "{{1}}"). Multi-parameter templates should
    // be sent via the adapter directly, not through the queue. The
    // env-driven `WHATSAPP_TEMPLATE_PREFIX` keeps platform-internal
    // template keys (e.g. `order.placed.email`) from being mistaken
    // for Meta template names.
    const prefix = process.env.WHATSAPP_TEMPLATE_PREFIX ?? 'wa:';
    let template:
      | {
          name: string;
          languageCode: string;
          parameters: Array<{ type: string; text: string }>;
        }
      | undefined;
    if (args.templateKey && args.templateKey.startsWith(prefix)) {
      const name = args.templateKey.slice(prefix.length);
      template = {
        name,
        languageCode: process.env.WHATSAPP_DEFAULT_LANGUAGE_CODE ?? 'en',
        parameters: [{ type: 'text', text: args.body }],
      };
    }

    const outcome = await this.adapter.send({
      phone,
      body: args.body,
      template,
    });

    if (outcome.sent) {
      return { success: true, providerMessageId: outcome.providerMessageId };
    }

    // Map adapter outcomes onto the notification-worker contract.
    if (outcome.blockedReason === 'NOT_CONFIGURED') {
      // Same behaviour as the prior stub — pretend success so dev
      // environments don't fail outright when credentials are absent.
      this.logger.warn(
        `WhatsApp not configured — skipping send to ${phone.slice(-4)}`,
      );
      return { success: true, providerMessageId: `unconfigured-${Date.now()}` };
    }

    return {
      success: false,
      failureReason: outcome.detail ?? outcome.blockedReason ?? 'unknown',
      retryable: outcome.retryable ?? false,
    };
  }
}
