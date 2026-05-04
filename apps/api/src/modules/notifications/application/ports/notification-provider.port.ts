import type { NotificationChannel } from '@prisma/client';

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');

export interface SendArgs {
  to: string;            // email / phone / wa.me id
  subject?: string;      // email-only; ignored by sms/whatsapp
  body: string;          // plain text or HTML depending on channel
  templateKey?: string;  // for logging / vendor template lookup
}

export interface SendResult {
  success: boolean;
  /** Vendor-side id (Razorpay-style) for traceability. */
  providerMessageId?: string;
  /** When false, why. Worker decides retry vs hard fail. */
  failureReason?: string;
  /** True when the failure is transient (network, 5xx, throttle). */
  retryable?: boolean;
}

/**
 * Channel-specific outbound sender. Each provider implementation handles
 * exactly one channel; the router picks the right one at dispatch time.
 */
export interface INotificationProvider {
  readonly channel: NotificationChannel;
  send(args: SendArgs): Promise<SendResult>;
}
