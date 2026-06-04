/**
 * Shadowfax webhook payload shape.
 * Source: https://docs.shadowfax.in/webhooks/tracking
 *
 * Shadowfax posts a single envelope per status change. Verification
 * is HMAC-SHA256 over the raw body, header `X-Shadowfax-Signature`.
 */

export interface ShadowfaxWebhookEvent {
  event_at: string;
  status: string;
  remark?: string;
  location?: string;
}

export interface ShadowfaxWebhookPayload {
  order_id: string;
  awb?: string;
  client_code: string;
  product_line: 'INTRACITY' | 'EXPRESS';
  current_status: string;
  current_event: ShadowfaxWebhookEvent;
  /** Optional full event dump on backfill webhooks. */
  events?: ShadowfaxWebhookEvent[];
}
