import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Phase 10 (PR 10.2) — Webhook HMAC signing.
 *
 * Format we send (in the request header `X-Webhook-Signature`):
 *
 *   t=<unix_seconds>,v1=<hex_hmac_sha256>
 *
 * Where the HMAC input is `<t>.<request_body>` (Stripe-style). The
 * timestamp prefix lets partners reject replays beyond a window of
 * their choice (recommended 5 min).
 *
 * Pure helpers — no DI. Used by the delivery service when sending
 * and exposed for partner-side verification reference.
 */

export interface SignedHeader {
  /** Full header value to send. */
  value: string;
  /** Same value's component fields, for tests. */
  timestamp: number;
  signature: string;
}

export function signPayload(
  rawBody: string,
  secret: string,
  now: Date = new Date(),
): SignedHeader {
  const timestamp = Math.floor(now.getTime() / 1000);
  const signed = `${timestamp}.${rawBody}`;
  const hmac = createHmac('sha256', secret).update(signed).digest('hex');
  return {
    timestamp,
    signature: hmac,
    value: `t=${timestamp},v1=${hmac}`,
  };
}

/**
 * Reference verifier matching the format above. Call sites are
 * test-only (the API sends, doesn't receive — partners use this as
 * a documentation reference).
 */
export function verifyPayload(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
  nowMs = Date.now(),
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=') as [string, string]),
  );
  const t = parseInt(parts.t ?? '0', 10);
  const v = parts.v1;
  if (!t || !v) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
