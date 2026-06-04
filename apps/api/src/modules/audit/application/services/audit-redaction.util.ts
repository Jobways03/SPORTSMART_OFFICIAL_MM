/**
 * Phase 203 (#10) — PII / secret scrubber for audit oldValue / newValue /
 * metadata.
 *
 * Audit rows carry arbitrary caller-supplied JSON (the before/after of a
 * mutated entity). Some entities legitimately contain secrets — a row that
 * captured "seller updated their API credentials" would otherwise persist the
 * plaintext token in the immutable, broadly-readable audit log forever.
 *
 * `redactSecrets` walks the JSON depth-first and replaces the VALUE of any key
 * whose name looks secret with `[REDACTED]`. It is intentionally conservative
 * (key-name based, not value-pattern based) so it never corrupts a legitimate
 * field, and it preserves structure so the audit row still shows "this key
 * changed" without leaking what it changed to.
 *
 * Applied in the repository `save()` so EVERY write is scrubbed, regardless of
 * which of the 27 callers produced it.
 */

const REDACTED = '[REDACTED]';

// Case-insensitive. A key matches if it CONTAINS any of these tokens, or ENDS
// WITH the suffix forms. Kept deliberately broad — over-redaction in an audit
// log is safe; under-redaction is a leak.
const SECRET_KEY_PATTERNS: RegExp[] = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /apikey/i,
  /api[_-]?key/i,
  /authorization/i,
  /auth[_-]?token/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /refresh[_-]?token/i,
  /session[_-]?id/i,
  /otp/i,
  /cvv/i,
  /pin/i,
  /_key$/i,
  /_secret$/i,
];

function keyIsSecret(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Deep-clone-and-redact. Returns a NEW structure (never mutates the input).
 * Arrays are walked element-wise; cycles are guarded with a WeakSet so a
 * self-referential object can't blow the stack. Non-plain values (Date,
 * number, string, bigint) pass through unchanged.
 */
export function redactSecrets(input: unknown, _seen?: WeakSet<object>): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;

  const seen = _seen ?? new WeakSet<object>();
  if (seen.has(input as object)) return '[CIRCULAR]';
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map((v) => redactSecrets(v, seen));
  }

  // Date / Buffer / other class instances: serialize-safe, don't descend.
  if (input instanceof Date) return input;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (keyIsSecret(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactSecrets(v, seen);
    }
  }
  return out;
}
