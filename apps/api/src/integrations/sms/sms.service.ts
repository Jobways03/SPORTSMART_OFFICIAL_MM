import { Injectable } from '@nestjs/common';
import { EnvService } from '../../bootstrap/env/env.service';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';

export interface SmsSendArgs {
  /** Destination phone. Any format; normalised to digits internally. */
  to: string;
  /** Message text. */
  body: string;
  /** TRAI DLT content-template id (required in prod for transactional SMS). */
  dltTemplateId?: string | null;
  /** TRAI DLT header / principal-entity id. */
  dltHeaderId?: string | null;
}

export type SmsBlockedReason =
  | 'NOT_CONFIGURED'
  | 'INVALID_NUMBER'
  | 'PROVIDER_ERROR';

export interface SmsSendResult {
  sent: boolean;
  providerMessageId?: string;
  blockedReason?: SmsBlockedReason;
  detail?: string;
  /** True when the caller may safely retry (network / 5xx / throttle). */
  retryable?: boolean;
}

/**
 * Phase 185 (#1) — real SMS integration.
 *
 * Pre-Phase-185 the only SMS path was a console stub inside the
 * notifications module that always reported success — the channel existed
 * in the enum but had no provider, so it could never reach a handset.
 *
 * This service is provider-switched via `SMS_PROVIDER`:
 *   • `stub`  (default) — logs + reports success, so dev/test and CI run
 *                         the full queue pipeline without credentials.
 *   • `msg91` — MSG91 Flow API (the dominant Indian transactional gateway;
 *               native DLT template-id support).
 *   • `twilio`— Twilio Messages API (international fallback).
 *
 * When the selected provider is configured-but-missing-credentials the
 * service no-ops with success (matches the WhatsApp/email idiom so a
 * half-configured environment doesn't wedge the queue). Production refuses
 * to boot without the credentials when `SMS_PROVIDER != stub` because they
 * are listed in `requiredInProd`.
 */
@Injectable()
export class SmsService {
  private readonly provider: string;
  private readonly authKey: string;
  private readonly senderId: string;
  private readonly apiUrl: string;

  constructor(
    private readonly env: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SmsService');
    this.provider = (this.env.getString('SMS_PROVIDER', 'stub') || 'stub').toLowerCase();
    this.authKey = this.env.getString('SMS_AUTH_KEY', '');
    this.senderId = this.env.getString('SMS_SENDER_ID', '');
    this.apiUrl = this.env.getString('SMS_API_URL', '');
  }

  /** True when a real (non-stub) provider is selected. */
  isRealProvider(): boolean {
    return this.provider === 'msg91' || this.provider === 'twilio';
  }

  async send(args: SmsSendArgs): Promise<SmsSendResult> {
    const phone = (args.to || '').replace(/\D/g, '');
    if (phone.length < 10) {
      return {
        sent: false,
        blockedReason: 'INVALID_NUMBER',
        detail: `Invalid phone number: ${args.to}`,
        retryable: false,
      };
    }

    switch (this.provider) {
      case 'msg91':
        return this.sendViaMsg91(phone, args);
      case 'twilio':
        return this.sendViaTwilio(phone, args);
      case 'stub':
      default:
        this.logger.warn(
          `[STUB-SMS] +${phone} | dlt=${args.dltTemplateId ?? '-'} | ${args.body.slice(0, 80)}`,
        );
        return { sent: true, providerMessageId: `stub-sms-${phone.slice(-4)}` };
    }
  }

  // ── MSG91 ───────────────────────────────────────────────────────────
  private async sendViaMsg91(phone: string, args: SmsSendArgs): Promise<SmsSendResult> {
    if (!this.authKey || !this.senderId) {
      this.logger.warn('MSG91 not configured (SMS_AUTH_KEY/SMS_SENDER_ID) — skipping send');
      return { sent: true, providerMessageId: `unconfigured-${Date.now()}`, blockedReason: 'NOT_CONFIGURED' };
    }
    const url = this.apiUrl || 'https://api.msg91.com/api/v5/flow/';
    try {
      // MSG91 Flow API: the DLT template id IS the flow id for
      // transactional sends. Body is supplied as a variable on the flow.
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: this.authKey,
        },
        body: JSON.stringify({
          template_id: args.dltTemplateId,
          sender: args.dltHeaderId || this.senderId,
          recipients: [{ mobiles: phone, body: args.body }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          sent: false,
          blockedReason: 'PROVIDER_ERROR',
          detail: `MSG91 ${res.status}: ${text.slice(0, 200)}`,
          // 4xx = bad request (non-retryable); 5xx/429 = transient.
          retryable: res.status >= 500 || res.status === 429,
        };
      }
      const json: any = await res.json().catch(() => ({}));
      return { sent: true, providerMessageId: json?.requestId ?? json?.message ?? `msg91-${Date.now()}` };
    } catch (err) {
      return {
        sent: false,
        blockedReason: 'PROVIDER_ERROR',
        detail: `MSG91 request failed: ${(err as Error).message}`,
        retryable: true,
      };
    }
  }

  // ── Twilio ──────────────────────────────────────────────────────────
  private async sendViaTwilio(phone: string, args: SmsSendArgs): Promise<SmsSendResult> {
    const accountSid = this.env.getString('SMS_AUTH_KEY', ''); // reuse: SID
    const authToken = this.env.getString('SMS_API_SECRET', '');
    if (!accountSid || !authToken || !this.senderId) {
      this.logger.warn('Twilio not configured — skipping send');
      return { sent: true, providerMessageId: `unconfigured-${Date.now()}`, blockedReason: 'NOT_CONFIGURED' };
    }
    const url =
      this.apiUrl ||
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    try {
      const form = new URLSearchParams({
        To: phone.startsWith('+') ? phone : `+${phone}`,
        From: this.senderId,
        Body: args.body,
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          sent: false,
          blockedReason: 'PROVIDER_ERROR',
          detail: `Twilio ${res.status}: ${text.slice(0, 200)}`,
          retryable: res.status >= 500 || res.status === 429,
        };
      }
      const json: any = await res.json().catch(() => ({}));
      return { sent: true, providerMessageId: json?.sid ?? `twilio-${Date.now()}` };
    } catch (err) {
      return {
        sent: false,
        blockedReason: 'PROVIDER_ERROR',
        detail: `Twilio request failed: ${(err as Error).message}`,
        retryable: true,
      };
    }
  }
}
