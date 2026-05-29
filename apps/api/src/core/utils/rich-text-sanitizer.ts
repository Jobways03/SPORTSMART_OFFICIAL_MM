// sanitize-html is a CJS module with a namespace export (IOptions
// type). The `import x = require()` form is the TS-idiomatic way to
// consume it while retaining namespace access, and is the pattern the
// library's own docs recommend.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sanitizeHtml = require('sanitize-html');

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote',
    'a',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
  },
  allowedSchemes: ['http', 'https'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: 'nofollow noopener',
        target: '_blank',
      },
    }),
  },
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * Phase 49 (2026-05-21) — CMS profile for static-page body fields
 * (Terms, Privacy, Shipping, etc.).
 *
 * Allows everything the blog/rich-text profile allows, PLUS:
 *   - images and figure for inline media
 *   - tables (Privacy/Refund pages often use tables for jurisdictions)
 *   - code/pre blocks (rare but valid)
 *   - `dir` attribute on text blocks for RTL languages
 *
 * Blocks:
 *   - <script>, <iframe>, <object>, <embed>, <link>, <style>, <meta>
 *     (handled implicitly by the allowlist — anything not listed
 *     is stripped)
 *   - All event-handler attributes (onclick, onload, onerror, …)
 *     (sanitize-html strips unlisted attributes by default)
 *   - javascript: / data: / vbscript: schemes in href / src
 *     (via allowedSchemes)
 */
const CMS_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote',
    'a', 'span', 'div',
    'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'code', 'pre',
    'hr',
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target', 'title'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    span: ['class'],
    div: ['class'],
    p: ['class', 'dir'],
    h1: ['dir'], h2: ['dir'], h3: ['dir'], h4: ['dir'], h5: ['dir'], h6: ['dir'],
    table: ['class'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  // No data: / javascript: / vbscript: schemes admitted anywhere.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const isExternal =
        !!attribs.href &&
        /^https?:\/\//i.test(attribs.href) &&
        !attribs.href.toLowerCase().includes('sportsmart');
      return {
        tagName,
        attribs: {
          ...attribs,
          rel: isExternal ? 'nofollow noopener noreferrer' : (attribs.rel ?? ''),
          ...(isExternal ? { target: '_blank' } : {}),
        },
      };
    },
  },
};

export function sanitizeCmsBody(html: string): string {
  return sanitizeHtml(html, CMS_SANITIZE_OPTIONS);
}

/**
 * Phase 49 — for fields that are rendered as plain text inside
 * attributes (metaTitle / metaDesc / FAQ answer when not rich-text).
 * Strips ALL HTML tags AND collapses whitespace, but does NOT
 * HTML-escape — the consumer's renderer is expected to escape.
 */
export function stripHtmlToPlainText(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

export function isRichTextEmpty(sanitizedHtml: string): boolean {
  const plainText = sanitizedHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return plainText.length === 0;
}

export function getPlainTextLength(sanitizedHtml: string): number {
  return sanitizedHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
    .length;
}
