/**
 * Phase 195 (Storefront Search audit) — shared search-input hardening.
 *
 * Two distinct concerns, both applied at the controller / facade boundary
 * before a user string ever reaches an ILIKE pattern:
 *
 *  - sanitizeSearchTerm: trims, collapses whitespace, strips ASCII control
 *    bytes (incl. NUL), and caps length. Stops a 2 KB payload from becoming
 *    a 2 KB ILIKE pattern (#7) and keeps non-printable bytes out of logs.
 *
 *  - escapeLikePattern: escapes the LIKE/ILIKE metacharacters % and _ (and
 *    the escape char \ itself). Without this, q="%" matches the ENTIRE
 *    catalog and q="ab_" matches any third character — a correctness +
 *    performance (DoS) vector, NOT SQL injection (Prisma.sql is still
 *    parameterized). PostgreSQL's default LIKE escape character is the
 *    backslash, so an escaped value works against a bare `ILIKE $1` with no
 *    explicit ESCAPE clause (#9).
 */

export const MAX_SEARCH_TERM_LENGTH = 100;
export const MIN_SEARCH_TERM_LENGTH = 2;

// Built from an escaped string (not a literal regex) so the control bytes
// are never embedded in the source file. Matches U+0000–U+001F and U+007F.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function sanitizeSearchTerm(
  raw: string | undefined | null,
  maxLength: number = MAX_SEARCH_TERM_LENGTH,
): string {
  if (!raw) return '';
  const cleaned = raw
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

export function escapeLikePattern(value: string): string {
  // Escape the escape char first so we don't double-process it.
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Convenience: sanitize + escape, returning the safe inner token (no %
 * wrapping). Callers wrap with `%${token}%` for a contains match. Returns
 * '' for input shorter than MIN_SEARCH_TERM_LENGTH so callers can skip the
 * search clause entirely.
 */
export function prepareSearchToken(
  raw: string | undefined | null,
  maxLength: number = MAX_SEARCH_TERM_LENGTH,
): string {
  const sanitized = sanitizeSearchTerm(raw, maxLength);
  if (sanitized.length < MIN_SEARCH_TERM_LENGTH) return '';
  return escapeLikePattern(sanitized);
}
