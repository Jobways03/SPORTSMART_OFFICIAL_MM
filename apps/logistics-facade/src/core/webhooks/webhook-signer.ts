import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook HMAC signing (Stripe-style). Format we send (or expect on
 * inbound partner webhooks once contracts are signed):
 *
 *   X-Webhook-Signature: t=<unix_seconds>,v1=<hex_hmac_sha256>
 *
 * HMAC input is `<t>.<request_body>`. The timestamp prefix lets the
 * verifier reject replays beyond a tolerance window.
 *
 * Pure helpers — no DI. Mirrors
 * apps/api/src/core/webhooks/webhook-signer.ts so the two services
 * agree on the wire shape for any cross-service webhook contracts.
 */
export interface SignedHeader {
  /** Full header value to send. */
  value: string;
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
 * Verifies a header against a body. Returns true only if the
 * signature matches AND the timestamp is within tolerance.
 *
 * @param toleranceSec — defaults to 300s, matches Stripe + apps/api's
 *                       Razorpay default replay window.
 */
export function verifySignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSec = 300,
  nowMs = Date.now(),
): boolean {
  const parts: Record<string, string> = {};
  for (const segment of header.split(',')) {
    const [k, v] = segment.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parseInt(parts.t ?? '0', 10);
  const v = parts.v1;
  if (!t || !v) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;

  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(v, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
