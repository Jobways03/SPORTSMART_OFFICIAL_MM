import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppClient } from '../clients/whatsapp.client';
import { redactPhone } from '../../../bootstrap/logging/log-redact';
import {
  WhatsappSessionService,
  SendabilityResult,
} from '../services/whatsapp-session.service';

/**
 * Phase 6 (2026-05-16) — outbound gate.
 *
 * Every send first asks the session service:
 *   - Has this phone opted out? → block, no exceptions.
 *   - Are we inside the 24h customer service window? → text allowed.
 *   - Outside the window? → only HSM templates allowed.
 *
 * This adapter is the *only* outbound surface the rest of the
 * platform should use. Direct `WhatsAppClient.sendTextMessage` calls
 * bypass the gate and risk Meta compliance hits — that is enforced
 * by code review rather than at the TS level, since the underlying
 * client is still exported for the small set of platform-internal
 * uses (webhook test pings, ops tools) that need to bypass the gate.
 */

export interface WhatsAppSendOutcome {
  /** True when Meta returned a message id. */
  sent: boolean;
  /** Meta-side id when `sent=true`. */
  providerMessageId?: string;
  /** Machine-readable reason when `sent=false`. */
  blockedReason?:
    | 'OPTED_OUT'
    | 'NO_PHONE'
    | 'OUT_OF_WINDOW_NO_TEMPLATE'
    | 'NOT_CONFIGURED'
    | 'SEND_FAILED';
  /** True when the failure is retryable (network/5xx). */
  retryable?: boolean;
  /** Free-text detail for logs. */
  detail?: string;
}

@Injectable()
export class WhatsAppAdapter {
  private readonly logger = new Logger(WhatsAppAdapter.name);

  constructor(
    private readonly client: WhatsAppClient,
    private readonly session: WhatsappSessionService,
  ) {}

  /**
   * Gate, then send. Free-form text is only allowed inside the 24h
   * customer-service window. Outside the window the caller must
   * supply a `template` argument; otherwise we refuse the send.
   *
   * Refusal is *not* an error — the result object carries the
   * `blockedReason` so the queue can drop or escalate without
   * polluting logs with exceptions.
   */
  async send(input: {
    phone: string;
    body: string;
    template?: {
      name: string;
      languageCode: string;
      parameters: Array<{ type: string; text: string }>;
    };
  }): Promise<WhatsAppSendOutcome> {
    if (!this.client.isConfigured) {
      this.logger.warn('WhatsApp not configured — message not sent');
      return { sent: false, blockedReason: 'NOT_CONFIGURED' };
    }

    const sendability: SendabilityResult = await this.session.checkSendability(
      input.phone,
    );

    if (!sendability.allowed) {
      this.logger.log(
        `WhatsApp send to ${redactPhone(input.phone)} blocked: ${sendability.blockedReason}`,
      );
      return {
        sent: false,
        blockedReason: sendability.blockedReason,
        detail: sendability.blockedReason,
      };
    }

    // Decide channel: template if explicitly provided, else text only
    // when inside the window.
    if (input.template) {
      return this.sendTemplate(input.phone, input.template);
    }

    if (!sendability.insideWindow) {
      this.logger.log(
        `WhatsApp send to ${redactPhone(input.phone)} blocked: outside 24h window and no template supplied`,
      );
      return {
        sent: false,
        blockedReason: 'OUT_OF_WINDOW_NO_TEMPLATE',
        detail:
          'No inbound from this phone in the last 24h — WhatsApp Cloud API requires a pre-approved template here',
      };
    }

    return this.sendText(input.phone, input.body);
  }

  /**
   * Send an order confirmation. The notifications path should use
   * `send()` directly with a Meta-approved template; this helper
   * remains for the legacy direct-call sites and selects a text body
   * suitable for inside-window sends only.
   */
  async sendOrderConfirmation(
    phoneNumber: string,
    orderNumber: string,
    totalAmount: number,
  ): Promise<WhatsAppSendOutcome> {
    return this.send({
      phone: phoneNumber,
      body: `Your order ${orderNumber} has been placed successfully! Total: ₹${totalAmount}. Track your order at our website.`,
    });
  }

  /**
   * Send a delivery update via WhatsApp. See `sendOrderConfirmation`
   * for the template-vs-text trade-off note.
   */
  async sendDeliveryUpdate(
    phoneNumber: string,
    orderNumber: string,
    status: string,
    trackingUrl?: string,
  ): Promise<WhatsAppSendOutcome> {
    let message = `Update for order ${orderNumber}: ${status}`;
    if (trackingUrl) message += `\nTrack: ${trackingUrl}`;
    return this.send({ phone: phoneNumber, body: message });
  }

  /**
   * Send a verification OTP via WhatsApp. OTP is one of the few flows
   * Meta allows via approved templates outside the 24h window, so the
   * caller passes a templateName matching their Meta-approved entry.
   * If none is given, we fall back to text (works only inside-window).
   */
  async sendOtp(
    phoneNumber: string,
    otp: string,
    options?: { templateName?: string; languageCode?: string },
  ): Promise<WhatsAppSendOutcome> {
    if (options?.templateName) {
      return this.send({
        phone: phoneNumber,
        body: `Your SPORTSMART verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
        template: {
          name: options.templateName,
          languageCode: options.languageCode ?? 'en',
          parameters: [{ type: 'text', text: otp }],
        },
      });
    }
    return this.send({
      phone: phoneNumber,
      body: `Your SPORTSMART verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
    });
  }

  /**
   * Generic notification — text only, inside-window only.
   */
  async sendNotification(
    phoneNumber: string,
    message: string,
  ): Promise<WhatsAppSendOutcome> {
    return this.send({ phone: phoneNumber, body: message });
  }

  // ── Internal helpers ───────────────────────────────────────────

  private async sendText(phone: string, body: string): Promise<WhatsAppSendOutcome> {
    try {
      const { messageId } = await this.client.sendTextMessage(phone, body);
      await this.session.recordOutbound(phone);
      return { sent: true, providerMessageId: messageId };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `WhatsApp text send to ${redactPhone(phone)} failed: ${message}`,
      );
      return {
        sent: false,
        blockedReason: 'SEND_FAILED',
        retryable: isRetryableProviderError(message),
        detail: message,
      };
    }
  }

  private async sendTemplate(
    phone: string,
    template: {
      name: string;
      languageCode: string;
      parameters: Array<{ type: string; text: string }>;
    },
  ): Promise<WhatsAppSendOutcome> {
    try {
      const { messageId } = await this.client.sendTemplateMessage(
        phone,
        template.name,
        template.languageCode,
        template.parameters,
      );
      await this.session.recordOutbound(phone);
      return { sent: true, providerMessageId: messageId };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `WhatsApp template send to ${redactPhone(phone)} failed: ${message}`,
      );
      return {
        sent: false,
        blockedReason: 'SEND_FAILED',
        retryable: isRetryableProviderError(message),
        detail: message,
      };
    }
  }
}

/**
 * Treat 5xx / 429 / timeouts as retryable; everything else (4xx,
 * banned numbers, malformed templates) is permanent.
 */
function isRetryableProviderError(message: string): boolean {
  const m = (message || '').toLowerCase();
  if (/failed \(5\d\d\)/.test(m)) return true;
  if (/failed \(429\)/.test(m)) return true;
  if (m.includes('aborterror')) return true;
  if (m.includes('timeout')) return true;
  return false;
}
