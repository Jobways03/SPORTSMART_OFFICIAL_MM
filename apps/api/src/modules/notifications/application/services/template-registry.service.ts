import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

export interface ResolvedTemplate {
  key: string;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
}

/**
 * Templates live primarily in `notification_templates`. Fallbacks are
 * defined in code so the system delivers something sensible BEFORE the
 * table is seeded — important for fresh installs and local dev.
 *
 * Lookup order: DB row (active=true) → code default → null.
 */
@Injectable()
export class TemplateRegistry {
  private readonly logger = new Logger(TemplateRegistry.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<ResolvedTemplate | null> {
    const row = await this.prisma.notificationTemplate.findUnique({
      where: { key },
    });
    if (row && row.active) {
      return {
        key: row.key,
        channel: row.channel,
        subject: row.subject,
        body: row.body,
      };
    }
    const fallback = DEFAULT_TEMPLATES[key];
    if (!fallback) {
      this.logger.warn(`No template (DB or default) for key: ${key}`);
      return null;
    }
    return { key, ...fallback };
  }
}

// ────────────────────────────────────────────────────────────────────
// Code-side defaults. Edit values here to change the out-of-the-box
// rendering; admin DB rows take precedence whenever they exist.
// ────────────────────────────────────────────────────────────────────

interface DefaultTemplate {
  channel: NotificationChannel;
  subject: string | null;
  body: string;
}

const DEFAULT_TEMPLATES: Record<string, DefaultTemplate> = {
  // ── Order ─────────────────────────────────────────────────────
  'order.placed.email': {
    channel: 'EMAIL',
    subject: 'Your Sportsmart order {{orderNumber}} is confirmed',
    body: brandWrap(`
      <h3 style="color:#16a34a;margin-top:0">Order placed</h3>
      <p>Hi {{customerName}},</p>
      <p>We've received your order. Thank you for shopping with Sportsmart!</p>
      <div style="background:#fff;border-radius:6px;padding:16px;margin:16px 0">
        <p style="margin:4px 0"><strong>Order:</strong> {{orderNumber}}</p>
        <p style="margin:4px 0"><strong>Items:</strong> {{itemCount}}</p>
        <p style="margin:4px 0"><strong>Total:</strong> ₹{{totalAmount}}</p>
      </div>
      <p>You can track this order any time in your <a href="{{orderUrl}}">account</a>.</p>
    `),
  },

  // ── Refund (settled — wallet OR external) ─────────────────────
  'refund.completed.email': {
    channel: 'EMAIL',
    subject: 'Refund for return {{returnNumber}} is complete',
    body: brandWrap(`
      <h3 style="color:#16a34a;margin-top:0">Refund processed</h3>
      <p>Hi {{customerName}},</p>
      <p>Your refund of <strong>₹{{refundAmount}}</strong> for return
      <strong>{{returnNumber}}</strong> has been processed.</p>
      <p>Reference: <code>{{refundReference}}</code></p>
    `),
  },

  // ── Wallet credit ─────────────────────────────────────────────
  'wallet.credited.email': {
    channel: 'EMAIL',
    subject: 'Your Sportsmart wallet was credited',
    body: brandWrap(`
      <h3 style="color:#16a34a;margin-top:0">Wallet credit</h3>
      <p>Hi {{customerName}},</p>
      <p><strong>₹{{amount}}</strong> has been added to your Sportsmart wallet.</p>
      <p style="color:#525a65;font-size:13px">{{description}}</p>
      <p>New balance: <strong>₹{{balanceAfter}}</strong></p>
      <p>Use it on your next order at checkout.</p>
    `),
  },

  // ── Support ticket — admin replied ────────────────────────────
  'ticket.replied.email': {
    channel: 'EMAIL',
    subject: 'New reply on your ticket {{ticketNumber}}',
    body: brandWrap(`
      <h3 style="margin-top:0">New reply on your ticket</h3>
      <p>Hi {{customerName}},</p>
      <p>The Sportsmart support team replied on
      <strong>{{ticketNumber}}</strong> — "{{ticketSubject}}".</p>
      <blockquote style="margin:12px 0;padding:12px 14px;background:#fff;border-left:3px solid #2A8595;border-radius:6px;color:#0F1115">
        {{messagePreview}}
      </blockquote>
      <p><a href="{{ticketUrl}}" style="color:#2A8595;font-weight:600">View the full thread →</a></p>
    `),
  },

  // ── Security: new device sign-in alert ───────────────────────
  'security.new_device_login': {
    channel: 'EMAIL',
    subject: 'New device sign-in to your Sportsmart account',
    body: brandWrap(`
      <h3 style="color:#dc2626;margin-top:0">New device sign-in</h3>
      <p>Hi {{customerName}},</p>
      <p>We noticed a sign-in to your account from a device or location we haven't seen before.</p>
      <div style="background:#fff;border-radius:6px;padding:16px;margin:16px 0">
        <p style="margin:4px 0"><strong>When:</strong> {{loginTime}}</p>
        <p style="margin:4px 0"><strong>IP:</strong> {{ipAddress}}</p>
        <p style="margin:4px 0"><strong>Browser:</strong> {{userAgent}}</p>
      </div>
      <p>If this was you, you can safely ignore this email.</p>
      <p>If you don't recognise this sign-in, please
      <a href="{{accessHistoryUrl}}" style="color:#dc2626;font-weight:600">review your access history</a>
      and change your password immediately.</p>
    `),
  },
};

function brandWrap(content: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <div style="text-align:center;margin-bottom:24px">
        <h2 style="color:#0F1115;margin:0;letter-spacing:-0.02em">SPORTSMART</h2>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
        ${content}
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px">
        Manage your notification preferences in <a href="{{preferencesUrl}}" style="color:#9ca3af">your account</a>.
      </p>
    </div>
  `;
}
