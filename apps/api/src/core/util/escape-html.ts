/**
 * Phase 5.3 (2026-05-16) — shared HTML escaping helpers.
 *
 * Pre-2026-05-16 these helpers existed as file-local functions inside
 * `EmailNotificationHandler`. Other handlers (return notifications,
 * dispute notifications, support replies) were interpolating raw
 * user input into HTML email templates, creating XSS vectors any time
 * a seller name / customer name / free-form reason field contained
 * `<script>` or attribute-breaking quotes. This module is the single
 * import path every handler must use.
 *
 * OWASP-standard escape: replaces the five characters that have
 * special meaning in HTML body / attribute contexts. Output is safe
 * to interpolate into `<p>`, `<span>`, `<title>`, `<input value="…">`
 * and other text/attribute positions; it is NOT safe for URL contexts
 * (use `encodeURIComponent` for those) or for inside `<script>` or
 * `<style>` blocks.
 */

/**
 * Replace HTML-special characters with entities. Pass strings only.
 * `null` / `undefined` / non-string values are coerced via `String()`
 * so callers don't need to pre-guard.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Branded marker for "this string is already trusted HTML, don't
 * escape it again." Pass values through `rawHtml(...)` only for
 * platform-controlled fragments (conditional spans, system links).
 * Never wrap user-controlled data — that re-opens the XSS hole this
 * helper exists to close.
 */
const RAW_HTML_TAG = Symbol('raw-html');
export type RawHtml = { readonly [RAW_HTML_TAG]: string };
export function rawHtml(s: string): RawHtml {
  return { [RAW_HTML_TAG]: s };
}
export function isRawHtml(v: unknown): v is RawHtml {
  return typeof v === 'object' && v !== null && RAW_HTML_TAG in v;
}

/**
 * Tagged-template helper for safely building HTML strings from
 * runtime data. Every `${value}` interpolation is HTML-escaped so
 * user-controlled strings cannot inject `<script>` or
 * attribute-breaking quotes into the rendered output.
 *
 * Usage:
 *   safeHtml`<p>Hi ${seller.sellerName},</p>`
 *
 * If a value is genuinely platform-controlled HTML that must render
 * as markup, wrap it with `rawHtml(...)` first — that marks it as
 * pre-trusted and skips the escape. Use sparingly and never for
 * user-controlled data.
 */
export function safeHtml(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let out = strings[0]!;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isRawHtml(v)) {
      out += v[RAW_HTML_TAG];
    } else {
      out += escapeHtml(v);
    }
    out += strings[i + 1];
  }
  return out;
}
