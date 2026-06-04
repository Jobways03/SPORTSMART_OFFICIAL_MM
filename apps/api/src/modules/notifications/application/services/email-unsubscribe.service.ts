import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';

export interface UnsubscribePayload {
  userId: string;
  eventClass: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
}

/**
 * Phase 189 (#14) — one-click email-unsubscribe links (CAN-SPAM / RFC 8058).
 *
 * A link embeds an HMAC-signed token of (userId, eventClass, channel) so the
 * unsubscribe endpoint needs NO customer auth (the user clicks it straight
 * from their inbox) yet can't be forged or replayed onto another user. The
 * token is opaque: `base64url(payload).hmacHex`.
 *
 * Templates can include `{{unsubscribeUrl}}` — the facade builds it for the
 * common (marketing, EMAIL) case via `buildUrl()`.
 */
@Injectable()
export class EmailUnsubscribeService {
  constructor(private readonly env: EnvService) {}

  private secret(): string {
    return this.env.getString('NOTIFICATION_UNSUBSCRIBE_SECRET', '');
  }

  /** Sign a token. Returns null if no secret is configured (fail closed). */
  sign(payload: UnsubscribePayload): string | null {
    const secret = this.secret();
    if (!secret) return null;
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const mac = createHmac('sha256', secret).update(body).digest('hex');
    return `${body}.${mac}`;
  }

  /** Verify + decode a token. Returns null on any tampering / missing secret. */
  verify(token: string): UnsubscribePayload | null {
    const secret = this.secret();
    if (!secret || !token || !token.includes('.')) return null;
    const [body, mac] = token.split('.', 2);
    if (!body || !mac) return null;
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(mac, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!parsed?.userId || !parsed?.eventClass || !parsed?.channel) return null;
      return parsed as UnsubscribePayload;
    } catch {
      return null;
    }
  }

  /** Build the customer-facing unsubscribe URL for a template variable. */
  buildUrl(
    userId: string,
    eventClass = 'marketing',
    channel: UnsubscribePayload['channel'] = 'EMAIL',
  ): string | null {
    const token = this.sign({ userId, eventClass, channel });
    if (!token) return null;
    const base = this.env.getString('APP_URL', 'http://localhost:8000').replace(/\/$/, '');
    return `${base}/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
  }
}
