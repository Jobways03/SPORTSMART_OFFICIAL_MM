// Opaque, expiring, HMAC-signed token that authorizes viewing ONE sub-order's
// shipping label via the PUBLIC (no-auth) label route. Every frontend opens the
// label with a raw window.open / <a href>, which carries no Bearer token — so
// the label URL must be openable without a guard. The signed token both
// authorizes (can't be forged) and scopes (can't enumerate other sub-orders by
// id), and it expires — same security model as a cloud presigned URL.

import { createHmac, timingSafeEqual } from 'crypto';

const SECRET =
  process.env.SHIPPING_LABEL_TOKEN_SECRET ||
  process.env.JWT_REFRESH_SECRET ||
  'sportsmart-label-token-dev-secret';

// 24h — mirrors Delhivery's own presigned-label-URL lifetime; the label is
// re-minted on every "Download" click anyway, so a short-ish window is fine.
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadB64: string): string {
  return b64url(createHmac('sha256', SECRET).update(payloadB64).digest());
}

/** Mint a token authorizing a label view for one sub-order. */
export function signLabelToken(
  subOrderId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadB64 = b64url(
    Buffer.from(JSON.stringify({ s: subOrderId, e: exp }), 'utf-8'),
  );
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify a token → sub-order id, or null on bad signature / expiry / malformed. */
export function verifyLabelToken(token: string): string | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.', 2);
  if (!payloadB64 || !sig) return null;

  const expectedSig = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(fromB64url(payloadB64).toString('utf-8')) as {
      s?: unknown;
      e?: unknown;
    };
    if (typeof parsed.s !== 'string' || typeof parsed.e !== 'number') {
      return null;
    }
    if (Math.floor(Date.now() / 1000) > parsed.e) return null;
    return parsed.s;
  } catch {
    return null;
  }
}
