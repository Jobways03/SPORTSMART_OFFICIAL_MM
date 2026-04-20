/**
 * Helpers for redacting PII before it lands in log aggregation.
 *
 * We deliberately keep a minimal, stable shape so log searches still
 * work — an operator tailing for a specific user can still match the
 * domain (for email) or the last four digits (for phone). We just
 * don't want the full value in the ELK-indexed log stream where it
 * could be reconstructed from historical data.
 *
 * If you need the unredacted value for support tooling, look up the
 * record from its id (the id is always safe to log).
 */

const REDACTED = '[redacted]';

export function redactEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return REDACTED;
  const at = email.indexOf('@');
  if (at <= 0) return REDACTED;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return REDACTED;
  const head = local[0] ?? '';
  return `${head}***@${domain}`;
}

export function redactPhone(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') return REDACTED;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return REDACTED;
  const tail = digits.slice(-4);
  return `***${tail}`;
}
