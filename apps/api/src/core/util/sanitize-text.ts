// Phase 95 (2026-05-23) — Phase 93 deferred #20 / #22 closure.
//
// Defense-in-depth input sanitization for free-text fields that may
// be rendered in admin or customer UIs (return reasonDetail,
// customerNotes, dispute notes, contest notes, etc.). The HTML
// templates already go through `safeHtml` at render time, but a
// hostile payload sitting in the database is still a footgun:
//
//   • A future code path could log/render it without escaping.
//   • CSV / PDF exports rarely escape HTML.
//   • Forensic review surfaces that copy notes verbatim into UI
//     strings would re-introduce the XSS we already closed at the
//     email handler.
//
// Strip everything that looks like HTML + control chars + collapse
// whitespace at the DTO boundary so the column never accepts a
// script-injection payload to begin with.

export interface SanitizeTextOptions {
  /** Cap length after stripping. Defaults to the column's @MaxLength. */
  maxLength?: number;
  /** Return null on empty/whitespace-only input. Default true. */
  nullifyEmpty?: boolean;
}

export function sanitizeText(
  raw: unknown,
  options: SanitizeTextOptions = {},
): string | null {
  const maxLength = options.maxLength ?? 5000;
  const nullifyEmpty = options.nullifyEmpty ?? true;
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw)
    // Strip angle-bracket tags entirely.
    .replace(/<[^>]*>/g, '')
    // Strip ASCII control chars (preserve \n \r \t for legitimate
    // multi-line input).
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse whitespace runs.
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return nullifyEmpty ? null : '';
  return cleaned.slice(0, maxLength);
}

/**
 * class-transformer-friendly variant. Returns `undefined` when the
 * input was undefined so the DTO field stays optional.
 */
export function sanitizeOptionalText(
  raw: unknown,
  options: SanitizeTextOptions = {},
): string | undefined {
  if (raw === undefined) return undefined;
  const result = sanitizeText(raw, options);
  return result === null ? undefined : result;
}
