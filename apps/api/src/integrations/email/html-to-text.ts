/**
 * Phase 5 follow-up (2026-05-16) — minimal HTML → plain-text converter
 * for the email plain-text fallback.
 *
 * The output is never going to be as polished as a hand-written
 * `text:` body, but it's substantially better than what some clients
 * (text-only mail-readers, accessibility screen-readers, spam-filter
 * snippet previews) render today: nothing.
 *
 * Conversions applied:
 *   - `<br>` and `<br/>` → newline
 *   - Block elements (`<p>`, `<div>`, `<h1>`…`<h6>`, `<li>`, `<tr>`,
 *     `<blockquote>`) → wrapped in blank lines so the result reads
 *     as paragraphs
 *   - `<a href="X">label</a>` → `label (X)` so links don't become
 *     orphan words
 *   - `<li>` → "- " bullet prefix
 *   - All other tags stripped
 *   - HTML entities decoded (`&amp;` → `&`, `&lt;` → `<`, etc.)
 *   - Whitespace collapsed
 *
 * Pure function — no DOM dependency, runs on every Node version we
 * ship. Output is canonical (idempotent: convert(html) === convert(convert(html))
 * for typical inputs).
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  let s = html;

  // 1. Normalise line breaks: <br>, <br/>, <br /> all become \n
  s = s.replace(/<br\s*\/?\s*>/gi, '\n');

  // 2. Anchor text: keep the label, append the URL in parens.
  //    Patterns we handle:
  //      <a href="X">label</a>       → "label (X)"
  //      <a href='X' …>label</a>     → "label (X)"
  //      <a href=X>label</a>         → "label (X)" (unquoted)
  s = s.replace(
    /<a\s[^>]*href\s*=\s*(["']?)([^"'\s>]+)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote, href, inner) => {
      const label = stripTags(inner).trim();
      const url = String(href).trim();
      if (!url) return label;
      if (!label || label === url) return url;
      return `${label} (${url})`;
    },
  );

  // 3. <li> bullets — prefix each one with "- " (after closing the
  //    previous block).
  s = s.replace(/<li[\s>][^>]*?>/gi, '\n- ');
  s = s.replace(/<\/li>/gi, '');

  // 4. Block-level boundaries: wrap with two newlines so the
  //    final whitespace pass collapses to paragraph breaks.
  const blockOpenClose = /<\/?(p|div|h[1-6]|tr|table|thead|tbody|tfoot|blockquote|ul|ol|section|article|header|footer|nav|aside)[\s>][^>]*?>/gi;
  s = s.replace(blockOpenClose, '\n\n');
  // Catch self-closing variants of the above.
  s = s.replace(
    /<(p|div|h[1-6]|tr|table|thead|tbody|tfoot|blockquote|ul|ol|section|article|header|footer|nav|aside)\s*\/>/gi,
    '\n\n',
  );

  // 5. <hr> → ruled-line of dashes (cheaper to read than nothing).
  s = s.replace(/<hr\s*\/?\s*>/gi, '\n----\n');

  // 6. Strip every remaining tag (open, close, self-closing).
  s = stripTags(s);

  // 7. Decode the five HTML entities we use in our `safeHtml` helper
  //    plus the most common named/numeric ones. Order matters —
  //    `&amp;` last so we don't double-decode (`&amp;lt;` should
  //    become `&lt;`, not `<`).
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
      return String.fromCodePoint(n);
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
      const n = parseInt(code, 16);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
      return String.fromCodePoint(n);
    })
    .replace(/&amp;/g, '&');

  // 8. Normalise whitespace — multiple spaces/tabs/CRs → single
  //    space; multiple newlines → at most two (paragraph break).
  s = s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
