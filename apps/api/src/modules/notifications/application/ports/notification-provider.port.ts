import type { NotificationChannel } from '@prisma/client';

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');

export interface SendArgs {
  to: string;            // email / phone / wa.me id
  subject?: string;      // email-only; ignored by sms/whatsapp
  body: string;          // plain text or HTML depending on channel
  templateKey?: string;  // for logging / vendor template lookup
  // Phase 185 (#4) — TRAI DLT registration ids, resolved from the template
  // at enqueue time. SMS-only; the SMS provider refuses to send a
  // transactional SMS without a DLT template id when enforcement is on.
  dltTemplateId?: string | null;
  dltHeaderId?: string | null;
}

export interface SendResult {
  success: boolean;
  /** Vendor-side id (Razorpay-style) for traceability. */
  providerMessageId?: string;
  /** When false, why. Worker decides retry vs hard fail. */
  failureReason?: string;
  /** True when the failure is transient (network, 5xx, throttle). */
  retryable?: boolean;
  // Phase 190 — richer capture for the notification log.
  /** Canonical failure code (maps to NotificationFailureCode). */
  failureCode?: string;
  /** Which provider handled the send (e.g. 'sendgrid', 'twilio', 'msg91'). */
  provider?: string;
  /** Sanitized, normalized provider response — NO secrets / internal IPs. */
  providerResponse?: Record<string, unknown>;
}

/**
 * Channel-specific outbound sender. Each provider implementation handles
 * exactly one channel; the router picks the right one at dispatch time.
 */
export interface INotificationProvider {
  readonly channel: NotificationChannel;
  send(args: SendArgs): Promise<SendResult>;
}
