// Stable random ID for X-Idempotency-Key headers on POST /place-order.
// RN doesn't ship crypto.randomUUID on every Hermes build, so fall back
// to a timestamp + random suffix when crypto isn't available.

declare const crypto:
  | {randomUUID?: () => string}
  | undefined;

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
