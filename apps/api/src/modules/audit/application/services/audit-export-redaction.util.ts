/**
 * Phase 206 (#6) — PII redaction for the CSV export's default `redacted` mode.
 *
 * The audit log carries IPs, user-agents, and arbitrary before/after JSON that
 * can contain emails / phone numbers. A finance or ops admin who only needs the
 * action trail should not be handed a spreadsheet of customer PII (which then
 * lives unencrypted on their laptop / in their inbox). `mode=full` exists for
 * the rare forensic case and is permission-gated + self-audited.
 */

/** IPv4 → /24 ("203.0.113.x"); IPv6 → /64 (first four hextets + "::"). */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '';
  const v = ip.trim();
  if (v.includes(':')) {
    // IPv6 — keep the routing /64, drop the interface identifier.
    const head = v.split(':').slice(0, 4).join(':');
    return `${head}::/64`;
  }
  const parts = v.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  return '[ip]';
}

/** Mask the local-part of an email: `john.doe@x.com` → `j***@x.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const first = local[0] ?? '';
  return `${first}***${domain}`;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Replace any email-looking substring in a free string with a masked form. */
export function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_RE, (m) => maskEmail(m));
}
